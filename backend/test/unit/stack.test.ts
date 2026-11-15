import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { LuxeBaddieStack } from "../../lib/luxebaddie-stack";
import { stageConfigFor } from "../../lib/stage-config";
import { BACK_OFFICE_ROUTES } from "../back-office-routes";

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

  it("requires AWS-signed requests on every admin route, the owner's sign-in on every back-office route, and nothing on public routes", () => {
    const routesWith = (auth: string) => apiRoutes().filter((r) => r.auth === auth).map((r) => r.route).sort();
    const under = (prefix: string) => BACK_OFFICE_ROUTES.map((route) => route.replace(" /", ` ${prefix}/`)).sort();

    expect(routesWith("AWS_IAM")).toEqual(under("/admin"));
    expect(routesWith("COGNITO_USER_POOLS")).toEqual(under("/backoffice"));
    expect(routesWith("NONE")).toEqual([
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

/** Every route of the API with how its caller is checked, e.g. { route: "GET /admin/product", auth: "AWS_IAM" }. */
function apiRoutes(): { route: string; auth: string }[] {
  const resources = template.findResources("AWS::ApiGateway::Resource");
  const methods = Object.values(template.findResources("AWS::ApiGateway::Method")).filter(
    (method) => method.Properties.HttpMethod !== "OPTIONS",
  );

  // Walks parent links to rebuild each method's full path, e.g. /admin/product/{id}.
  const pathOf = (ref: { Ref?: string }): string => {
    const resource = ref.Ref ? resources[ref.Ref] : undefined;
    return resource ? `${pathOf(resource.Properties.ParentId)}/${resource.Properties.PathPart}` : "";
  };

  return methods.map((method) => ({
    route: `${method.Properties.HttpMethod} ${pathOf(method.Properties.ResourceId)}`,
    auth: method.Properties.AuthorizationType,
  }));
}

describe("owner sign-in", () => {
  it("lets nobody register: accounts exist by invitation only", () => {
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
    });
  });

  it("requires a second step from an authenticator app, never a text message or an email", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      MfaConfiguration: "ON",
      EnabledMfas: ["SOFTWARE_TOKEN_MFA"],
    });
  });

  it("ends a session after twelve hours and a token after fifteen minutes", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      RefreshTokenValidity: 720,
      IdTokenValidity: 15,
      AccessTokenValidity: 15,
      TokenValidityUnits: { RefreshToken: "minutes", IdToken: "minutes", AccessToken: "minutes" },
      EnableTokenRevocation: true,
    });
  });

  it("gives the browser no secret to keep and does not say which emails have an account", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      PreventUserExistenceErrors: "ENABLED",
    });
  });

  it("checks the owner's token against this user pool on every request", () => {
    template.resourceCountIs("AWS::ApiGateway::Authorizer", 1);
    template.hasResourceProperties("AWS::ApiGateway::Authorizer", {
      Type: "COGNITO_USER_POOLS",
      IdentitySource: "method.request.header.Authorization",
      AuthorizerResultTtlInSeconds: 0,
      ProviderARNs: [{ "Fn::GetAtt": [Match.stringLikeRegexp("^OwnerSignInOwners"), "Arn"] }],
    });
  });

  it("lets a browser page read the API's refusals", () => {
    for (const ResponseType of ["DEFAULT_4XX", "DEFAULT_5XX"]) {
      template.hasResourceProperties("AWS::ApiGateway::GatewayResponse", {
        ResponseType,
        ResponseParameters: { "gatewayresponse.header.Access-Control-Allow-Origin": "'*'" },
      });
    }
  });

  it("allows password sign-in through the AWS API only where the end-to-end tests run", () => {
    const flowsOf = (candidate: Template) =>
      Object.values(candidate.findResources("AWS::Cognito::UserPoolClient"))[0]?.Properties.ExplicitAuthFlows;
    const withoutTests = new LuxeBaddieStack(new App(), "NoTests", {
      config: { ...stageConfigFor("dev"), endToEndTestAccess: false },
      env: { account: "123456789012", region: "us-east-1" },
    });

    expect(flowsOf(template)).toContain("ALLOW_ADMIN_USER_PASSWORD_AUTH");
    expect(flowsOf(Template.fromStack(withoutTests))).not.toContain("ALLOW_ADMIN_USER_PASSWORD_AUTH");
  }, 120_000);
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

  it("records on the site when each build started, before publishing it", () => {
    const [project] = Object.values(template.findResources("AWS::CodeBuild::Project"));
    const commands: string[] = project?.Properties.Source.BuildSpec.split("\n");
    const lineOf = (text: string) => commands.findIndex((command) => command.includes(text));

    expect(lineOf("web/out/build.json")).toBeGreaterThan(lineOf("pnpm --filter @luxebaddie/web build"));
    expect(lineOf("web/out/build.json")).toBeLessThan(lineOf("aws s3 sync"));
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

describe("end-to-end test access", () => {
  const testerStatements = () => statementsOf("AWS::IAM::Policy", "EndToEndTestAccessTester");
  const statement = (sid: string) => testerStatements().find((candidate) => candidate.Sid === sid);

  it("lets only this repository's main branch run the tests", () => {
    const [role] = Object.values(
      template.findResources("AWS::IAM::Role", { Properties: { RoleName: "luxebaddie-dev-github-e2e" } }),
    );
    const trust = role?.Properties.AssumeRolePolicyDocument.Statement;

    expect(trust).toHaveLength(1);
    expect(trust[0].Action).toBe("sts:AssumeRoleWithWebIdentity");
    expect(trust[0].Condition).toEqual({
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:rossislike@111800579/luxebaddie@1458066475:ref:refs/heads/main",
      },
    });
  });

  it("allows what the tests do and nothing more", () => {
    expect(testerStatements().map((candidate) => [candidate.Sid, candidate.Action])).toEqual([
      ["FindTheStage", "cloudformation:DescribeStacks"],
      ["CallTheAdminRoutes", "execute-api:Invoke"],
      ["AnnounceAPaidCheckout", "events:PutEvents"],
      ["RemoveTheOrdersItCreated", "dynamodb:DeleteItem"],
      [
        "SignInAsATemporaryOwner",
        [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminInitiateAuth",
          "cognito-idp:AdminRespondToAuthChallenge",
          "cognito-idp:AdminUserGlobalSignOut",
          "cognito-idp:AdminDeleteUser",
        ],
      ],
      ["SeeWhetherStripeIsConnected", "ssm:DescribeParameters"],
    ]);
  });

  it("reaches the admin routes of this stage's API only", () => {
    const routes = JSON.stringify(statement("CallTheAdminRoutes")?.Resource);

    expect(routes).toContain('{"Ref":"ApiGatewayapi');
    expect(routes).toContain('{"Ref":"ApiGatewayapiDeploymentStagedev');
    expect(routes).toContain('"/*/admin/*"');
  });

  it("can publish a paid checkout but no other event", () => {
    expect(statement("AnnounceAPaidCheckout")?.Condition).toEqual({
      StringEquals: { "events:source": "com.luxebaddie.payment", "events:detail-type": "CheckoutCompleted" },
    });
  });

  it("can delete orders but no other item", () => {
    expect(statement("RemoveTheOrdersItCreated")?.Condition).toEqual({
      "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["ORDER#*"] },
    });
  });

  it("manages owners of this stage's user pool only", () => {
    expect(statement("SignInAsATemporaryOwner")?.Resource).toEqual({
      "Fn::GetAtt": [expect.stringMatching(/^OwnerSignInOwners/), "Arn"],
    });
  });

  it("cannot read a Stripe key", () => {
    const actions = testerStatements().flatMap((candidate) => candidate.Action);

    expect(actions.filter((action) => action.startsWith("ssm:") || action.startsWith("kms:"))).toEqual(["ssm:DescribeParameters"]);
  });

  it("does not exist on a stage that turns it off", () => {
    const stack = new LuxeBaddieStack(new App(), "NoTestAccess", {
      config: { ...stageConfigFor("dev"), endToEndTestAccess: false },
      env: { account: "123456789012", region: "us-east-1" },
    });

    expect(Template.fromStack(stack).findResources("AWS::IAM::Role", { Properties: { RoleName: Match.anyValue() } })).toEqual({});
  }, 120_000);
});
