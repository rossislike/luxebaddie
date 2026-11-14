import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { LuxeBaddieStack } from "../../lib/luxebaddie-stack";
import { stageConfigFor } from "../../lib/stage-config";

let template: Template;

beforeAll(() => {
  const app = new App();
  const stack = new LuxeBaddieStack(app, "TestStack", {
    config: stageConfigFor("dev"),
    env: { account: "123456789012", region: "us-east-1" },
  });
  template = Template.fromStack(stack);
}, 120_000);

type Resource = { [key: string]: any };

/** The Lambdas we wrote, leaving out the helper functions the CDK adds for its own housekeeping. */
const serviceFunctions = (): Record<string, Resource> =>
  Object.fromEntries(
    Object.entries(template.findResources("AWS::Lambda::Function")).filter(([id]) => id.startsWith("Microservices")),
  );

function ruleMatching(eventPattern: Record<string, unknown>): Resource {
  const [rule] = Object.values(template.findResources("AWS::Events::Rule", { Properties: { EventPattern: eventPattern } }));
  if (!rule) throw new Error(`No rule matches ${JSON.stringify(eventPattern)}`);
  return rule;
}

const statementsOf = (policyType: string, idPart: string): Record<string, any>[] =>
  Object.entries(template.findResources(policyType))
    .filter(([id]) => id.includes(idPart))
    .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement);

describe("LuxeBaddieStack", () => {
  it("stores everything in one on-demand table with generic keys and expiry", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: { AttributeName: "TTL", Enabled: true },
    });
  });

  it("gives each index its own key attributes and projects whole items", () => {
    const [table] = Object.values(template.findResources("AWS::DynamoDB::Table"));
    const indexes = table?.Properties.GlobalSecondaryIndexes.map(
      (index: { IndexName: string; KeySchema: { AttributeName: string }[]; Projection: { ProjectionType: string } }) => ({
        name: index.IndexName,
        keys: index.KeySchema.map((key) => key.AttributeName),
        projection: index.Projection.ProjectionType,
      }),
    );

    expect(indexes).toEqual([
      { name: "GSI1", keys: ["GSI1PK", "GSI1SK"], projection: "ALL" },
      { name: "GSI2", keys: ["GSI2PK", "GSI2SK"], projection: "ALL" },
    ]);
  });

  it("confines each service to its own items in the shared table", () => {
    type Statement = { Action: string | string[]; Resource: unknown; Condition?: Record<string, Record<string, string[]>> };
    const dynamoGrantsOf = (service: string) =>
      Object.entries(template.findResources("AWS::IAM::Policy"))
        .filter(([id]) => id.includes(`${service}LambdaFunction`))
        .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement as Statement[])
        .filter((statement) => [statement.Action].flat().some((action) => action.startsWith("dynamodb:")))
        .map((statement) => ({
          actions: [statement.Action].flat().map((action) => action.replace("dynamodb:", "")),
          onIndex: JSON.stringify(statement.Resource).match(/index\/(GSI\d)/)?.[1] ?? null,
          keys: statement.Condition?.["ForAllValues:StringLike"]?.["dynamodb:LeadingKeys"],
        }));

    expect(dynamoGrantsOf("product")).toEqual([
      { actions: ["GetItem", "PutItem", "DeleteItem"], onIndex: null, keys: ["PRODUCT#*"] },
      { actions: ["Query"], onIndex: "GSI1", keys: ["CATALOG*"] },
    ]);
    expect(dynamoGrantsOf("basket")).toEqual([
      { actions: ["GetItem", "PutItem", "DeleteItem"], onIndex: null, keys: ["BASKET#*"] },
      { actions: ["BatchGetItem"], onIndex: null, keys: ["PRODUCT#*"] },
    ]);
    expect(dynamoGrantsOf("ordering")).toEqual([
      { actions: ["GetItem", "PutItem"], onIndex: null, keys: ["ORDER#*"] },
      { actions: ["Query"], onIndex: "GSI1", keys: ["CUSTOMER#*"] },
      { actions: ["Query"], onIndex: "GSI2", keys: ["FULFILLMENT#*"] },
    ]);
    expect(dynamoGrantsOf("payment")).toEqual([]);
  });

  it("creates one Lambda per microservice, plus the product service's change relay", () => {
    expect(Object.keys(serviceFunctions()).map((id) => id.replace(/LambdaFunction.*/, "")).sort()).toEqual([
      "Microservicesbasket",
      "Microservicesordering",
      "Microservicespayment",
      "Microservicesproduct",
      "MicroservicesproductChangeRelay",
      "Microservicesstorefront",
    ]);
    for (const fn of Object.values(serviceFunctions())) {
      expect(fn.Properties).toMatchObject({ Runtime: "nodejs24.x", Architectures: ["arm64"] });
    }
  });

  it("fans CheckoutCompleted out to one queue per subscriber", () => {
    const rule = ruleMatching({ source: ["com.luxebaddie.payment"], "detail-type": ["CheckoutCompleted"] });

    expect(rule.Properties.Targets).toHaveLength(2);
    for (const target of rule.Properties.Targets) {
      expect(target.DeadLetterConfig).toBeDefined();
    }
  });

  it("gives every subscriber queue a dead-letter queue, an alarm and per-message retries", () => {
    const subscribers = 3; // order, paid basket, storefront rebuild
    template.resourcePropertiesCountIs("AWS::SQS::Queue", { RedrivePolicy: Match.anyValue() }, subscribers);
    template.resourcePropertiesCountIs(
      "AWS::Lambda::EventSourceMapping",
      { FunctionResponseTypes: ["ReportBatchItemFailures"] },
      subscribers,
    );
    template.resourcePropertiesCountIs(
      "AWS::CloudWatch::Alarm",
      { MetricName: "ApproximateNumberOfMessagesVisible" },
      subscribers + 1, // and the catalog change feed's dead-letter queue
    );
  });

  it("traces requests end to end", () => {
    for (const fn of Object.values(serviceFunctions())) {
      expect(fn.Properties.TracingConfig).toEqual({ Mode: "Active" });
    }
    template.hasResourceProperties("AWS::ApiGateway::Stage", { TracingEnabled: true });
  });

  it("opens public routes to everyone but leaves admin routes to this account's IAM", () => {
    const [api] = Object.values(template.findResources("AWS::ApiGateway::RestApi"));
    const [allow] = api?.Properties.Policy.Statement.filter((s: { Effect: string }) => s.Effect === "Allow");

    expect(allow.Principal).toEqual({ AWS: "*" });
    expect(allow.Resource).toContain("execute-api:/*/GET/product");
    expect(allow.Resource.filter((route: string) => route.includes("admin"))).toEqual([]);
  });

  it("accepts Stripe webhooks from Stripe's addresses only", () => {
    const [api] = Object.values(template.findResources("AWS::ApiGateway::RestApi"));
    const [deny] = api?.Properties.Policy.Statement.filter((s: { Effect: string }) => s.Effect === "Deny");

    expect(deny.Resource).toBe("execute-api:/*/POST/payment/webhook");
    expect(deny.Condition.NotIpAddress["aws:SourceIp"]).toContain("54.187.216.72");
  });

  it("lets each service read only its own Stripe key", () => {
    const policies = Object.entries(template.findResources("AWS::IAM::Policy")).map(([id, policy]) => ({
      id,
      document: JSON.stringify(policy.Properties.PolicyDocument),
    }));
    const readersOf = (parameter: string) => policies.filter((p) => p.document.includes(parameter)).map((p) => p.id);

    expect(readersOf("stripe/basket-api-key")).toEqual([expect.stringMatching(/basketLambdaFunction/)]);
    expect(readersOf("stripe/payment-api-key")).toEqual([expect.stringMatching(/paymentLambdaFunction/)]);
    expect(readersOf("stripe/webhook-secret")).toEqual([expect.stringMatching(/paymentLambdaFunction/)]);
  });

  it("requires IAM auth on every admin route and none on public routes", () => {
    const resources = template.findResources("AWS::ApiGateway::Resource");
    const methods = Object.values(template.findResources("AWS::ApiGateway::Method")).filter(
      (m) => m.Properties.HttpMethod !== "OPTIONS",
    );

    // Walks parent links to rebuild each method's full path, e.g. /admin/product/{id}.
    const pathOf = (ref: { Ref?: string }): string => {
      const resource = ref.Ref ? resources[ref.Ref] : undefined;
      return resource ? `${pathOf(resource.Properties.ParentId)}/${resource.Properties.PathPart}` : "";
    };

    const routes = methods.map((m) => ({
      route: `${m.Properties.HttpMethod} ${pathOf(m.Properties.ResourceId)}`,
      auth: m.Properties.AuthorizationType,
    }));

    expect(routes.filter((r) => r.auth === "AWS_IAM").map((r) => r.route).sort()).toEqual([
      "DELETE /admin/product/{id}",
      "GET /admin/customer/{email}/order",
      "GET /admin/order",
      "GET /admin/order/{id}",
      "GET /admin/product",
      "PUT /admin/product/{id}",
    ]);
    expect(routes.filter((r) => r.auth === "NONE").map((r) => r.route).sort()).toEqual([
      "DELETE /basket/{id}",
      "GET /basket/{id}",
      "GET /order/session/{sessionId}",
      "GET /product",
      "GET /product/{id}",
      "POST /basket/{id}/checkout",
      "POST /payment/webhook",
      "PUT /basket/{id}",
    ]);
  });
});

describe("catalog change feed", () => {
  it("records every write to the table, with the item before and after", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" },
    });
  });

  it("feeds product changes, and only those, to the change relay", () => {
    const [feed] = Object.values(template.findResources("AWS::Lambda::EventSourceMapping")).filter(
      (mapping) => JSON.stringify(mapping.Properties.EventSourceArn).includes("StreamArn"),
    );

    expect(JSON.stringify(feed?.Properties.FunctionName)).toContain("productChangeRelay");
    expect(feed?.Properties.FilterCriteria.Filters.map((f: { Pattern: string }) => JSON.parse(f.Pattern))).toEqual([
      { dynamodb: { Keys: { PK: { S: [{ prefix: "PRODUCT#" }] } } } },
    ]);
  });

  it("sets aside a change that cannot be relayed instead of blocking the ones behind it", () => {
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BisectBatchOnFunctionError: true,
      MaximumRetryAttempts: 10,
      DestinationConfig: { OnFailure: Match.anyValue() },
    });
  });

  it("keeps the change relay away from the table itself", () => {
    const actions = statementsOf("AWS::IAM::Policy", "productChangeRelay").flatMap((statement) => statement.Action);

    expect(actions.filter((action) => action.startsWith("dynamodb:")).sort()).toEqual([
      "dynamodb:DescribeStream",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:ListStreams",
    ]);
    expect(actions).toContain("events:PutEvents");
  });
});

describe("storefront hosting", () => {
  it("keeps the site and its logs in private, encrypted, HTTPS-only buckets", () => {
    template.resourceCountIs("AWS::S3::Bucket", 2);
    template.allResourcesProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] },
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
    });
    const denyPlainHttp = statementsOf("AWS::S3::BucketPolicy", "StorefrontHosting").filter(
      (statement) => statement.Effect === "Deny" && statement.Condition?.Bool?.["aws:SecureTransport"] === "false",
    );
    expect(denyPlainHttp).toHaveLength(2);
  });

  it("lets only this distribution, in this account, read the site", () => {
    const readers = statementsOf("AWS::S3::BucketPolicy", "StorefrontHostingSite").filter(
      (statement) => statement.Effect === "Allow" && [statement.Action].flat().includes("s3:GetObject"),
    );

    expect(readers.map((statement) => statement.Principal)).toEqual([{ Service: "cloudfront.amazonaws.com" }]);
    expect(Object.keys(readers[0]?.Condition.StringEquals)).toEqual(["AWS:SourceArn", "AWS:SourceAccount"]);
    template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: { OriginAccessControlOriginType: "s3", SigningBehavior: "always", SigningProtocol: "sigv4" },
    });
  });

  it("serves the storefront over HTTPS only, through the page router", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultRootObject: "index.html",
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: "redirect-to-https",
          Compress: true,
          FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
        },
      },
    });
  });

  it("answers an unknown address with the 404 page", () => {
    const [distribution] = Object.values(template.findResources("AWS::CloudFront::Distribution"));

    expect(distribution?.Properties.DistributionConfig.CustomErrorResponses).toEqual(
      [403, 404].map((ErrorCode) => expect.objectContaining({ ErrorCode, ResponseCode: 404, ResponsePagePath: "/404.html" })),
    );
  });

  it("adds the security headers to every response", () => {
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: {
          StrictTransportSecurity: { AccessControlMaxAgeSec: 63_072_000, IncludeSubdomains: true, Override: true },
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: "DENY", Override: true },
          ContentSecurityPolicy: { ContentSecurityPolicy: "frame-ancestors 'none'", Override: true },
          ReferrerPolicy: { ReferrerPolicy: "strict-origin-when-cross-origin", Override: true },
        },
        CustomHeadersConfig: {
          Items: Match.arrayWith([Match.objectLike({ Header: "Permissions-Policy" })]),
        },
      },
    });
  });

  it("logs every request, without the query string, referrer or cookies", () => {
    const [delivery] = Object.values(template.findResources("AWS::Logs::Delivery"));

    expect(delivery?.Properties.RecordFields).toContain("cs-uri-stem");
    for (const sensitive of ["cs-uri-query", "cs(Referer)", "cs(Cookie)"]) {
      expect(delivery?.Properties.RecordFields).not.toContain(sensitive);
    }
  });

  it("tells the services where the storefront is", () => {
    const { basket } = Object.fromEntries(
      Object.entries(serviceFunctions()).map(([id, fn]) => [id.replace(/^Microservices|LambdaFunction.*$/g, ""), fn]),
    );
    const { STOREFRONT_URL, ALLOWED_ORIGINS } = basket?.Properties.Environment.Variables;

    expect(JSON.stringify(STOREFRONT_URL)).toContain("StorefrontHostingDistribution");
    expect(JSON.stringify(ALLOWED_ORIGINS)).toContain("StorefrontHostingDistribution");
    expect(JSON.stringify(ALLOWED_ORIGINS)).toContain("http://localhost:3000");
  });
});

describe("storefront build", () => {
  it("runs one build at a time, so an older build can never overwrite a newer one", () => {
    template.hasResourceProperties("AWS::CodeBuild::Project", { ConcurrentBuildLimit: 1 });
  });

  it("builds against this stage's API and publishes to this stage's bucket and distribution", () => {
    const [project] = Object.values(template.findResources("AWS::CodeBuild::Project"));
    const variables = project?.Properties.Environment.EnvironmentVariables.map((v: { Name: string }) => v.Name);

    expect(variables.sort()).toEqual(["DISTRIBUTION_ID", "NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_SITE_URL", "SITE_BUCKET"]);
  });

  it("rebuilds when the catalog changes and when a deployment finishes", () => {
    const catalogChanged = ruleMatching({ source: ["com.luxebaddie.product"], "detail-type": ["CatalogChanged"] });
    const deploymentFinished = ruleMatching({
      source: ["aws.cloudformation"],
      "detail-type": ["CloudFormation Stack Status Change"],
      detail: Match.objectLike({
        "status-details": { status: ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"] },
      }),
    });

    for (const rule of [catalogChanged, deploymentFinished]) {
      expect(JSON.stringify(rule.Properties.Targets)).toContain("StorefrontRebuildQueue");
    }
  });

  it("collects a burst of changes into one batch for the storefront service", () => {
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      MaximumBatchingWindowInSeconds: 30,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
    });
  });

  it("lets the storefront service start builds of this project and nothing else", () => {
    const [startBuild] = statementsOf("AWS::IAM::Policy", "storefrontLambdaFunction").filter(
      (statement) => statement.Action === "codebuild:StartBuild",
    );

    expect(JSON.stringify(startBuild?.Resource)).toContain("StorefrontBuildProject");
  });

  it("raises an alarm when a build fails", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", { MetricName: "FailedBuilds", Namespace: "AWS/CodeBuild" });
  });
});
