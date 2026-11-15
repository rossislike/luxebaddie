import { Duration } from "aws-cdk-lib";
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  type MethodOptions,
  ResponseType,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import type { IUserPool } from "aws-cdk-lib/aws-cognito";
import { AnyPrincipal, Effect, PolicyDocument, PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { AWS_SIGNED_PREFIX, OWNER_SIGNED_IN_PREFIX } from "../src/shared/back-office";
import type { StageConfig } from "./stage-config";
import { STRIPE_WEBHOOK_IPS } from "./stripe-webhook-ips";

interface LbApiGatewayProps {
  config: StageConfig;
  /** Browser origins allowed to call the API (CORS): the stage's storefronts and back offices. */
  allowedOrigins: string[];
  /** Whoever is signed in to this user pool may use the back-office routes. */
  ownerUserPool: IUserPool;
  productMicroservice: IFunction;
  basketMicroservice: IFunction;
  paymentMicroservice: IFunction;
  orderingMicroservice: IFunction;
}

/**
 * One REST API in front of all microservices, so the storefront has a single
 * base URL. The storefront's routes are public and rate limited. The
 * back-office routes exist twice, and each copy checks the caller differently
 * (see src/shared/back-office.ts):
 *
 *  - under /admin they require IAM-signed (SigV4) requests: only AWS
 *    identities granted access (scripts, automation, tests) can call them;
 *  - under /backoffice they require the sign-in token of an owner signed in
 *    to the user pool.
 */
export class LbApiGateway extends Construct {
  public readonly api: RestApi;
  private readonly awsSigned: MethodOptions = { authorizationType: AuthorizationType.IAM };
  private readonly ownerSignedIn: MethodOptions;

  constructor(scope: Construct, id: string, props: LbApiGatewayProps) {
    super(scope, id);

    this.api = new RestApi(this, "api", {
      restApiName: `LuxeBaddie API (${props.config.stage})`,
      deployOptions: {
        stageName: props.config.stage,
        metricsEnabled: true,
        tracingEnabled: true,
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: props.allowedOrigins,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
      policy: apiAccessPolicy(),
      // Each Lambda is wired explicitly below, so no account-wide CloudWatch role is needed.
      cloudWatchRole: false,
    });

    this.ownerSignedIn = {
      authorizationType: AuthorizationType.COGNITO,
      // Accepts any ID token this user pool issued, whichever app client it was
      // issued to. The pool has one client; a second one would get in here too.
      authorizer: new CognitoUserPoolsAuthorizer(this, "OwnerAuthorizer", {
        cognitoUserPools: [props.ownerUserPool],
        // Check every request's token, so an expired one is refused at once
        // rather than when a cached verdict runs out.
        resultsCacheTtl: Duration.seconds(0),
      }),
    };
    this.letBrowsersReadRefusals();

    this.addProductRoutes(new LambdaIntegration(props.productMicroservice));
    this.addBasketRoutes(new LambdaIntegration(props.basketMicroservice));
    this.addPaymentRoutes(new LambdaIntegration(props.paymentMicroservice));
    this.addOrderRoutes(new LambdaIntegration(props.orderingMicroservice));
  }

  /** Adds one back-office route under both of its doors, e.g. ("GET", "/product") as /admin/product and /backoffice/product. */
  private addBackOfficeRoute(method: string, path: string, integration: LambdaIntegration) {
    this.api.root.resourceForPath(`${AWS_SIGNED_PREFIX}${path}`).addMethod(method, integration, this.awsSigned);
    this.api.root.resourceForPath(`${OWNER_SIGNED_IN_PREFIX}${path}`).addMethod(method, integration, this.ownerSignedIn);
  }

  /**
   * When API Gateway itself refuses a request (no sign-in token, an expired
   * one, too many requests) no Lambda runs to add the CORS header, and without
   * it a browser hides the answer from the page that asked. These refusals
   * carry no data, so any page may read them: that is how the back office
   * tells "sign in again" apart from "the network is down".
   */
  private letBrowsersReadRefusals() {
    const readableByAnyPage = { "Access-Control-Allow-Origin": "'*'" };
    this.api.addGatewayResponse("ClientErrors", { type: ResponseType.DEFAULT_4XX, responseHeaders: readableByAnyPage });
    this.api.addGatewayResponse("ServerErrors", { type: ResponseType.DEFAULT_5XX, responseHeaders: readableByAnyPage });
  }

  private addProductRoutes(integration: LambdaIntegration) {
    const product = this.api.root.addResource("product");
    product.addMethod("GET", integration); // GET /product
    product.addResource("{id}").addMethod("GET", integration); // GET /product/{id}

    this.addBackOfficeRoute("GET", "/product", integration);
    this.addBackOfficeRoute("PUT", "/product/{id}", integration);
    this.addBackOfficeRoute("DELETE", "/product/{id}", integration);
  }

  private addBasketRoutes(integration: LambdaIntegration) {
    const singleBasket = this.api.root.addResource("basket").addResource("{id}");
    singleBasket.addMethod("GET", integration); // GET /basket/{id}
    singleBasket.addMethod("PUT", integration); // PUT /basket/{id}
    singleBasket.addMethod("DELETE", integration); // DELETE /basket/{id}
    singleBasket.addResource("checkout").addMethod("POST", integration); // POST /basket/{id}/checkout
  }

  private addPaymentRoutes(integration: LambdaIntegration) {
    // POST /payment/webhook - only reachable from Stripe's addresses, then verified by signature inside the Lambda
    this.api.root.addResource("payment").addResource("webhook").addMethod("POST", integration);
  }

  private addOrderRoutes(integration: LambdaIntegration) {
    // GET /order/session/{sessionId} - the order confirmation page
    this.api.root.addResource("order").addResource("session").addResource("{sessionId}").addMethod("GET", integration);

    this.addBackOfficeRoute("GET", "/order", integration); // ?fulfillmentStatus=
    this.addBackOfficeRoute("GET", "/order/{id}", integration);
    // One customer's orders, for support.
    this.addBackOfficeRoute("GET", "/customer/{email}/order", integration);
  }
}

/** Paths are relative to this API: execute-api:/<stage>/<method>/<path>. */
const WEBHOOK_ROUTE = "execute-api:/*/POST/payment/webhook";
const PUBLIC_ROUTES = [
  "execute-api:/*/GET/product",
  "execute-api:/*/GET/product/*",
  "execute-api:/*/*/basket/*",
  "execute-api:/*/GET/order/session/*",
  "execute-api:/*/OPTIONS/*", // CORS preflight
  WEBHOOK_ROUTE,
];
/**
 * A browser has no AWS credentials, so these have to be reachable without
 * any. Each method on them then demands the owner's sign-in token.
 */
const OWNER_SIGNED_IN_ROUTES = `execute-api:/*/*${OWNER_SIGNED_IN_PREFIX}/*`;

/**
 * Who may call the API at all, checked before any Lambda runs.
 *
 * Public routes are open to anyone. The /admin routes are deliberately absent
 * from the allow list: they are reachable only by identities in this AWS
 * account that hold IAM permission to invoke them. The Stripe webhook is
 * additionally refused unless the call comes from one of Stripe's addresses.
 */
function apiAccessPolicy(): PolicyDocument {
  return new PolicyDocument({
    statements: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new AnyPrincipal()],
        actions: ["execute-api:Invoke"],
        resources: [...PUBLIC_ROUTES, OWNER_SIGNED_IN_ROUTES],
      }),
      new PolicyStatement({
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        actions: ["execute-api:Invoke"],
        resources: [WEBHOOK_ROUTE],
        conditions: { NotIpAddress: { "aws:SourceIp": STRIPE_WEBHOOK_IPS } },
      }),
    ],
  });
}
