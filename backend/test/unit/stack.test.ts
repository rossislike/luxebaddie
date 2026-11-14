import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { LuxeBaddyStack } from "../../lib/luxebaddy-stack";
import { stageConfigFor } from "../../lib/stage-config";

let template: Template;

beforeAll(() => {
  const app = new App();
  const stack = new LuxeBaddyStack(app, "TestStack", {
    config: stageConfigFor("dev"),
    env: { account: "123456789012", region: "us-east-1" },
  });
  template = Template.fromStack(stack);
}, 120_000);

describe("LuxeBaddyStack", () => {
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

  it("creates one Lambda per microservice", () => {
    template.resourceCountIs("AWS::Lambda::Function", 4);
    template.allResourcesProperties("AWS::Lambda::Function", { Runtime: "nodejs24.x", Architectures: ["arm64"] });
  });

  it("fans CheckoutCompleted out to one queue per subscriber", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: { source: ["com.luxebaddy.payment"], "detail-type": ["CheckoutCompleted"] },
    });
    const [rule] = Object.values(template.findResources("AWS::Events::Rule"));
    expect(rule?.Properties.Targets).toHaveLength(2);
    for (const target of rule?.Properties.Targets ?? []) {
      expect(target.DeadLetterConfig).toBeDefined();
    }
  });

  it("gives every subscriber queue a dead-letter queue, an alarm and per-message retries", () => {
    template.resourceCountIs("AWS::SQS::Queue", 4);
    template.resourcePropertiesCountIs("AWS::SQS::Queue", { RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }) }, 2);
    template.resourcePropertiesCountIs(
      "AWS::Lambda::EventSourceMapping",
      { FunctionResponseTypes: ["ReportBatchItemFailures"] },
      2,
    );
    template.resourcePropertiesCountIs(
      "AWS::CloudWatch::Alarm",
      { MetricName: "ApproximateNumberOfMessagesVisible" },
      2,
    );
  });

  it("traces requests end to end", () => {
    template.allResourcesProperties("AWS::Lambda::Function", { TracingConfig: { Mode: "Active" } });
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
