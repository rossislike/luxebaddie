import { AuthorizationType, Cors, LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { AnyPrincipal, Effect, PolicyDocument, PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import type { StageConfig } from "./stage-config";
import { STRIPE_WEBHOOK_IPS } from "./stripe-webhook-ips";

interface LbApiGatewayProps {
  config: StageConfig;
  productMicroservice: IFunction;
  basketMicroservice: IFunction;
  paymentMicroservice: IFunction;
  orderingMicroservice: IFunction;
}

/**
 * One REST API in front of all microservices, so the storefront has a single
 * base URL. Routes under /admin require IAM-signed (SigV4) requests: only AWS
 * identities you grant access to (you, and later the automation workflows) can
 * call them. Everything else is public and rate limited.
 */
export class LbApiGateway extends Construct {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string, props: LbApiGatewayProps) {
    super(scope, id);

    this.api = new RestApi(this, "api", {
      restApiName: `LuxeBaddy API (${props.config.stage})`,
      deployOptions: {
        stageName: props.config.stage,
        metricsEnabled: true,
        tracingEnabled: true,
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: props.config.allowedOrigins,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ["Content-Type"],
      },
      policy: apiAccessPolicy(),
      // Each Lambda is wired explicitly below, so no account-wide CloudWatch role is needed.
      cloudWatchRole: false,
    });

    const admin = this.api.root.addResource("admin");
    const iamAuth = { authorizationType: AuthorizationType.IAM };

    this.addProductRoutes(admin, new LambdaIntegration(props.productMicroservice), iamAuth);
    this.addBasketRoutes(new LambdaIntegration(props.basketMicroservice));
    this.addPaymentRoutes(new LambdaIntegration(props.paymentMicroservice));
    this.addOrderRoutes(admin, new LambdaIntegration(props.orderingMicroservice), iamAuth);
  }

  private addProductRoutes(admin: AdminResource, integration: LambdaIntegration, iamAuth: IamAuth) {
    const product = this.api.root.addResource("product");
    product.addMethod("GET", integration); // GET /product
    product.addResource("{id}").addMethod("GET", integration); // GET /product/{id}

    const adminProduct = admin.addResource("product");
    adminProduct.addMethod("GET", integration, iamAuth); // GET /admin/product
    const adminSingleProduct = adminProduct.addResource("{id}");
    adminSingleProduct.addMethod("PUT", integration, iamAuth); // PUT /admin/product/{id}
    adminSingleProduct.addMethod("DELETE", integration, iamAuth); // DELETE /admin/product/{id}
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

  private addOrderRoutes(admin: AdminResource, integration: LambdaIntegration, iamAuth: IamAuth) {
    // GET /order/session/{sessionId} - the order confirmation page
    this.api.root.addResource("order").addResource("session").addResource("{sessionId}").addMethod("GET", integration);

    const adminOrder = admin.addResource("order");
    adminOrder.addMethod("GET", integration, iamAuth); // GET /admin/order?fulfillmentStatus=
    adminOrder.addResource("{id}").addMethod("GET", integration, iamAuth); // GET /admin/order/{id}

    // GET /admin/customer/{email}/order - one customer's orders, for support
    admin.addResource("customer").addResource("{email}").addResource("order").addMethod("GET", integration, iamAuth);
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
        resources: PUBLIC_ROUTES,
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

type AdminResource = ReturnType<RestApi["root"]["addResource"]>;
type IamAuth = { authorizationType: AuthorizationType };
