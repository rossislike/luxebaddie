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
import { LbQueue } from "./queue";
import type { StageConfig } from "./stage-config";
import { LbStorefrontBuild } from "./storefront-build";
import { LbStorefrontHosting } from "./storefront-hosting";

interface LuxeBaddieStackProps extends StackProps {
  config: StageConfig;
}

export class LuxeBaddieStack extends Stack {
  constructor(scope: Construct, id: string, props: LuxeBaddieStackProps) {
    super(scope, id, props);
    const { config } = props;

    const database = new LbDatabase(this, "Database", { retainData: config.retainData });

    const eventBus = new LbEventBus(this, "EventBus");

    // The storefront's address exists before anything is published to it, so
    // the services can be told where shoppers come from and return to.
    const storefrontHosting = new LbStorefrontHosting(this, "StorefrontHosting", { config });
    const allowedOrigins = [storefrontHosting.url, ...config.localStorefrontOrigins];

    const microservices = new LbMicroservices(this, "Microservices", {
      config,
      table: database.table,
      eventBus: eventBus.bus,
      storefrontUrl: storefrontHosting.url,
      allowedOrigins,
    });

    const ownerSignIn = new LbOwnerSignIn(this, "OwnerSignIn", { config });

    const apigateway = new LbApiGateway(this, "ApiGateway", {
      config,
      allowedOrigins,
      ownerUserPool: ownerSignIn.userPool,
      productMicroservice: microservices.productMicroservice,
      basketMicroservice: microservices.basketMicroservice,
      paymentMicroservice: microservices.paymentMicroservice,
      orderingMicroservice: microservices.orderingMicroservice,
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
    const storefrontBuild = new LbStorefrontBuild(this, "StorefrontBuild", {
      config,
      hosting: storefrontHosting,
      apiUrl,
      publisher: microservices.storefrontMicroservice,
      rebuildQueue: storefrontRebuildQueue,
    });

    const monitoring = new LbMonitoring(this, "Monitoring", {
      config,
      api: apigateway.api,
      functions: {
        product: microservices.productMicroservice,
        basket: microservices.basketMicroservice,
        payment: microservices.paymentMicroservice,
        ordering: microservices.orderingMicroservice,
        productChangeRelay: microservices.productChangeRelay,
        storefront: microservices.storefrontMicroservice,
      },
      queues: { order: orderQueue, paidBasket: paidBasketQueue, storefrontRebuild: storefrontRebuildQueue },
      changeFeedDeadLetterQueues: { catalog: catalogChangeFeed.deadLetterQueue },
      storefront: { distribution: storefrontHosting.distribution, build: storefrontBuild.project },
    });

    if (config.endToEndTestAccess) {
      new LbEndToEndTestAccess(this, "EndToEndTestAccess", {
        config,
        api: apigateway.api,
        eventBus: eventBus.bus,
        table: database.table,
        ownerUserPool: ownerSignIn.userPool,
      });
    }

    new CfnOutput(this, "StorefrontUrl", { value: storefrontHosting.url });
    new CfnOutput(this, "StorefrontBucketName", { value: storefrontHosting.bucket.bucketName });
    new CfnOutput(this, "StorefrontBuildProject", { value: storefrontBuild.project.projectName });
    new CfnOutput(this, "ApiUrl", { value: apiUrl });
    new CfnOutput(this, "StripeWebhookUrl", { value: `${apiUrl}/payment/webhook` });
    new CfnOutput(this, "EventBusName", { value: eventBus.bus.eventBusName });
    new CfnOutput(this, "TableName", { value: database.table.tableName });
    new CfnOutput(this, "OwnerUserPoolId", { value: ownerSignIn.userPool.userPoolId });
    new CfnOutput(this, "OwnerUserPoolClientId", { value: ownerSignIn.client.userPoolClientId });
    new CfnOutput(this, "OrderDeadLetterQueueUrl", { value: orderQueue.deadLetterQueue.queueUrl });
    new CfnOutput(this, "AlarmTopicArn", { value: monitoring.alarmTopic.topicArn });
    new CfnOutput(this, "DashboardName", { value: monitoring.dashboard.dashboardName });
  }
}
