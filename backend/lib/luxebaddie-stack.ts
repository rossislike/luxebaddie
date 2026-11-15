import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { LbApiGateway } from "./apigateway";
import { LbChangeFeed } from "./change-feed";
import { LbDatabase } from "./database";
import { LbEndToEndTestAccess } from "./end-to-end-test-access";
import { LbEventBus } from "./eventbus";
import { LbMicroservices } from "./microservices";
import { LbMonitoring } from "./monitoring";
import { LbOwnerSignIn } from "./owner-sign-in";
import { LbProductPhotos } from "./product-photos";
import { LbQueue } from "./queue";
import type { StageConfig } from "./stage-config";
import { LbSiteBuild, type SiteSource } from "./site-build";
import { LbSiteHosting } from "./site-hosting";

interface LuxeBaddieStackProps extends StackProps {
  config: StageConfig;
}

/** The stage's two static sites. Each is a workspace package, built and hosted the same way. */
const STOREFRONT: SiteSource = { name: "storefront", title: "storefront", directory: "web", packageName: "@luxebaddie/web" };
const BACK_OFFICE: SiteSource = {
  name: "backoffice",
  title: "back office",
  directory: "backoffice",
  packageName: "@luxebaddie/backoffice",
};

export class LuxeBaddieStack extends Stack {
  constructor(scope: Construct, id: string, props: LuxeBaddieStackProps) {
    super(scope, id, props);
    const { config } = props;

    const database = new LbDatabase(this, "Database", { retainData: config.retainData });

    const eventBus = new LbEventBus(this, "EventBus");

    // The sites' addresses exist before anything is published to them, so the
    // services can be told where shoppers and the owner come from and return to.
    const storefrontHosting = new LbSiteHosting(this, "StorefrontHosting", { config, site: STOREFRONT });
    // The back office has its own address, so nothing that runs on the
    // storefront (an ad pixel, say) can reach the owner's sign-in.
    const backOfficeHosting = new LbSiteHosting(this, "BackOfficeHosting", {
      config,
      site: BACK_OFFICE,
      hiddenFromSearchEngines: true,
    });
    const backOfficeOrigins = [backOfficeHosting.url, ...config.localBackOfficeOrigins];
    const allowedOrigins = [storefrontHosting.url, ...config.localStorefrontOrigins, ...backOfficeOrigins];

    const microservices = new LbMicroservices(this, "Microservices", {
      config,
      table: database.table,
      eventBus: eventBus.bus,
      storefrontUrl: storefrontHosting.url,
      allowedOrigins,
    });

    const productPhotos = new LbProductPhotos(this, "ProductPhotos", {
      config,
      storefront: storefrontHosting,
      uploader: microservices.productMicroservice,
      uploadOrigins: backOfficeOrigins,
    });

    const ownerSignIn = new LbOwnerSignIn(this, "OwnerSignIn", {
      config,
      backOfficeUrl: backOfficeHosting.url,
      backOfficeOrigins,
    });

    const apigateway = new LbApiGateway(this, "ApiGateway", {
      config,
      allowedOrigins,
      ownerUserPool: ownerSignIn.userPool,
      productMicroservice: microservices.productMicroservice,
      basketMicroservice: microservices.basketMicroservice,
      paymentMicroservice: microservices.paymentMicroservice,
      orderingMicroservice: microservices.orderingMicroservice,
      activityMicroservice: microservices.activityMicroservice,
    });

    // Each subscriber to CheckoutCompleted has its own queue (and dead-letter queue).
    const orderQueue = new LbQueue(this, "OrderQueue", {
      consumer: microservices.orderingMicroservice,
    });
    const paidBasketQueue = new LbQueue(this, "PaidBasketQueue", {
      consumer: microservices.basketMicroservice,
    });
    eventBus.subscribeToCheckoutCompleted([orderQueue, paidBasketQueue]);

    // No trailing slash, so callers can append paths like `${ApiUrl}/product`.
    const { api } = apigateway;
    const apiUrl = `https://${api.restApiId}.execute-api.${this.region}.${this.urlSuffix}/${api.deploymentStage.stageName}`;

    // Product writes -> change stream -> CatalogChanged -> rebuild queue -> storefront build.
    const catalogChangeFeed = new LbChangeFeed(this, "CatalogChangeFeed", {
      table: database.table,
      keyPrefix: "PRODUCT#",
      relay: microservices.productChangeRelay,
    });
    const storefrontRebuildQueue = new LbQueue(this, "StorefrontRebuildQueue", {
      consumer: microservices.storefrontMicroservice,
      // A burst of catalog edits (seeding, a bulk price change) becomes one build.
      collectFor: Duration.seconds(30),
      // A request that arrives while a build is running is retried until that
      // build ends. Ten deliveries, three minutes apart, is half an hour.
      maxReceiveCount: 10,
    });
    eventBus.subscribeToCatalogChanged([storefrontRebuildQueue]);
    const storefrontBuild = new LbSiteBuild(this, "StorefrontBuild", {
      config,
      site: STOREFRONT,
      hosting: storefrontHosting,
      settings: { NEXT_PUBLIC_API_URL: apiUrl, NEXT_PUBLIC_SITE_URL: storefrontHosting.url },
      publisher: microservices.storefrontMicroservice,
      rebuildQueue: storefrontRebuildQueue,
    });

    // The back office has no catalog pages, so only a deployment makes it out of date.
    const backOfficeRebuildQueue = new LbQueue(this, "BackOfficeRebuildQueue", {
      consumer: microservices.backOfficePublisher,
      collectFor: Duration.seconds(30),
      maxReceiveCount: 10,
    });
    const backOfficeBuild = new LbSiteBuild(this, "BackOfficeBuild", {
      config,
      site: BACK_OFFICE,
      hosting: backOfficeHosting,
      settings: {
        NEXT_PUBLIC_API_URL: apiUrl,
        NEXT_PUBLIC_SIGN_IN_ISSUER: ownerSignIn.issuer,
        NEXT_PUBLIC_SIGN_IN_CLIENT_ID: ownerSignIn.client.userPoolClientId,
        NEXT_PUBLIC_SIGN_IN_PAGES_URL: ownerSignIn.pagesUrl,
        NEXT_PUBLIC_PHOTO_UPLOAD_URL: productPhotos.uploadOrigin,
      },
      publisher: microservices.backOfficePublisher,
      rebuildQueue: backOfficeRebuildQueue,
    });

    // See startAccessLogsAfter: the API and each site's build are the last
    // things created that mention the sites' addresses.
    storefrontHosting.startAccessLogsAfter(api.deploymentStage, storefrontBuild.project);
    backOfficeHosting.startAccessLogsAfter(api.deploymentStage, backOfficeBuild.project);

    const monitoring = new LbMonitoring(this, "Monitoring", {
      config,
      api: apigateway.api,
      functions: {
        product: microservices.productMicroservice,
        basket: microservices.basketMicroservice,
        payment: microservices.paymentMicroservice,
        ordering: microservices.orderingMicroservice,
        activity: microservices.activityMicroservice,
        productChangeRelay: microservices.productChangeRelay,
        storefront: microservices.storefrontMicroservice,
        backOfficePublisher: microservices.backOfficePublisher,
      },
      queues: {
        order: orderQueue,
        paidBasket: paidBasketQueue,
        storefrontRebuild: storefrontRebuildQueue,
        backOfficeRebuild: backOfficeRebuildQueue,
      },
      changeFeedDeadLetterQueues: { catalog: catalogChangeFeed.deadLetterQueue },
      sites: {
        Storefront: { title: STOREFRONT.title, distribution: storefrontHosting.distribution, build: storefrontBuild.project },
        BackOffice: { title: BACK_OFFICE.title, distribution: backOfficeHosting.distribution, build: backOfficeBuild.project },
      },
    });

    if (config.endToEndTestAccess) {
      new LbEndToEndTestAccess(this, "EndToEndTestAccess", {
        config,
        api: apigateway.api,
        eventBus: eventBus.bus,
        table: database.table,
        ownerUserPool: ownerSignIn.userPool,
        photoBucket: productPhotos.bucket,
      });
    }

    new CfnOutput(this, "StorefrontUrl", { value: storefrontHosting.url });
    new CfnOutput(this, "StorefrontBucketName", { value: storefrontHosting.bucket.bucketName });
    new CfnOutput(this, "StorefrontBuildProject", { value: storefrontBuild.project.projectName });
    new CfnOutput(this, "BackOfficeUrl", { value: backOfficeHosting.url });
    new CfnOutput(this, "BackOfficeBucketName", { value: backOfficeHosting.bucket.bucketName });
    new CfnOutput(this, "BackOfficeBuildProject", { value: backOfficeBuild.project.projectName });
    new CfnOutput(this, "ApiUrl", { value: apiUrl });
    new CfnOutput(this, "StripeWebhookUrl", { value: `${apiUrl}/payment/webhook` });
    new CfnOutput(this, "EventBusName", { value: eventBus.bus.eventBusName });
    new CfnOutput(this, "PhotoBucketName", { value: productPhotos.bucket.bucketName });
    new CfnOutput(this, "PhotoUploadUrl", { value: productPhotos.uploadOrigin });
    new CfnOutput(this, "TableName", { value: database.table.tableName });
    new CfnOutput(this, "OwnerUserPoolId", { value: ownerSignIn.userPool.userPoolId });
    new CfnOutput(this, "OwnerUserPoolClientId", { value: ownerSignIn.client.userPoolClientId });
    new CfnOutput(this, "OwnerSignInIssuer", { value: ownerSignIn.issuer });
    new CfnOutput(this, "OwnerSignInPagesUrl", { value: ownerSignIn.pagesUrl });
    new CfnOutput(this, "OrderDeadLetterQueueUrl", { value: orderQueue.deadLetterQueue.queueUrl });
    new CfnOutput(this, "AlarmTopicArn", { value: monitoring.alarmTopic.topicArn });
    new CfnOutput(this, "DashboardName", { value: monitoring.dashboard.dashboardName });
  }
}
