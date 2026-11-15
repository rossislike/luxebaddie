import { fileURLToPath } from "node:url";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import type { IEventBus } from "aws-cdk-lib/aws-events";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, LoggingFormat, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, type NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { GSI1, GSI2 } from "../src/table/schema";
import { itemsWithKeyPrefix } from "./database";
import { secretParameterNames, type StageConfig } from "./stage-config";

interface LbMicroservicesProps {
  config: StageConfig;
  table: ITable;
  eventBus: IEventBus;
  /** The stage's main storefront: where shoppers return to after checkout. No trailing slash. */
  storefrontUrl: string;
  /** Browser origins allowed to call the API (CORS): the stage's storefronts. */
  allowedOrigins: string[];
}

const sourcePath = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

export class LbMicroservices extends Construct {
  public readonly productMicroservice: NodejsFunction;
  /** Publishes CatalogChanged from the table's change stream. Fed by an LbChangeFeed. */
  public readonly productChangeRelay: NodejsFunction;
  public readonly basketMicroservice: NodejsFunction;
  public readonly paymentMicroservice: NodejsFunction;
  public readonly orderingMicroservice: NodejsFunction;
  /** Starts storefront rebuilds. Given its build project by LbStorefrontBuild. */
  public readonly storefrontMicroservice: NodejsFunction;

  constructor(scope: Construct, id: string, props: LbMicroservicesProps) {
    super(scope, id);
    const { config } = props;

    const secrets = secretParameterNames(config.stage);
    const secureParameter = (id: string, parameterName: string) =>
      StringParameter.fromSecureStringParameterAttributes(this, id, { parameterName });
    const basketStripeKey = secureParameter("BasketStripeKey", secrets.basketStripeKey);
    const paymentStripeKey = secureParameter("PaymentStripeKey", secrets.paymentStripeKey);
    const stripeWebhookSecret = secureParameter("StripeWebhookSecret", secrets.stripeWebhookSecret);

    const createFunction = (name: string, environment: Record<string, string>, extra: NodejsFunctionProps = {}) =>
      new NodejsFunction(this, `${name}LambdaFunction`, {
        entry: sourcePath(`src/${name}/index.ts`),
        depsLockFilePath: sourcePath("../pnpm-lock.yaml"),
        runtime: Runtime.NODEJS_24_X,
        architecture: Architecture.ARM_64,
        memorySize: 512,
        // Longer than the worst case of every remote call's retry budget combined,
        // shorter than API Gateway's 29 second limit.
        timeout: Duration.seconds(25),
        tracing: Tracing.ACTIVE,
        loggingFormat: LoggingFormat.JSON,
        logGroup: new LogGroup(this, `${name}Logs`, {
          retention: config.retainData ? RetentionDays.SIX_MONTHS : RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        bundling: { minify: true, sourceMap: true },
        environment: {
          NODE_OPTIONS: "--enable-source-maps",
          STAGE: config.stage,
          ALLOWED_ORIGINS: props.allowedOrigins.join(","),
          ...environment,
        },
        ...extra,
      });

    const { table } = props;

    /**
     * All services share one table, but each may only touch its own items.
     * These grants allow an action only when the item's partition key starts
     * with one of the given prefixes, so service boundaries are enforced by
     * IAM rather than by convention.
     */
    const allowItems = (fn: NodejsFunction, actions: string[], keyPrefixes: string[]) =>
      fn.addToRolePolicy(
        new PolicyStatement({
          actions: actions.map((action) => `dynamodb:${action}`),
          resources: [table.tableArn],
          conditions: itemsWithKeyPrefix(keyPrefixes),
        }),
      );
    const allowIndexQuery = (fn: NodejsFunction, indexName: string, partitionPrefixes: string[]) =>
      fn.addToRolePolicy(
        new PolicyStatement({
          actions: ["dynamodb:Query"],
          resources: [`${table.tableArn}/index/${indexName}`],
          conditions: itemsWithKeyPrefix(partitionPrefixes),
        }),
      );

    // Product microservice: the catalog.
    this.productMicroservice = createFunction("product", { TABLE_NAME: table.tableName });
    allowItems(this.productMicroservice, ["GetItem", "PutItem", "DeleteItem"], ["PRODUCT#"]);
    allowIndexQuery(this.productMicroservice, GSI1, ["CATALOG"]);

    // The product service's second Lambda. It has no table access: its only
    // input is the change stream, its only output the event bus.
    this.productChangeRelay = createFunction(
      "productChangeRelay",
      { EVENT_BUS_NAME: props.eventBus.eventBusName },
      { entry: sourcePath("src/product/change-relay.ts") },
    );
    props.eventBus.grantPutEventsTo(this.productChangeRelay);

    // Basket microservice: the bag, priced from the catalog (read-only), and the hand-off to Stripe Checkout.
    this.basketMicroservice = createFunction("basket", {
      TABLE_NAME: table.tableName,
      STOREFRONT_URL: props.storefrontUrl,
      STRIPE_API_KEY_PARAM: secrets.basketStripeKey,
      STRIPE_AUTOMATIC_TAX: String(config.stripeAutomaticTax),
    });
    allowItems(this.basketMicroservice, ["GetItem", "PutItem", "DeleteItem"], ["BASKET#"]);
    allowItems(this.basketMicroservice, ["BatchGetItem"], ["PRODUCT#"]);
    basketStripeKey.grantRead(this.basketMicroservice);

    // Payment microservice: receives Stripe webhooks and publishes CheckoutCompleted.
    this.paymentMicroservice = createFunction("payment", {
      EVENT_BUS_NAME: props.eventBus.eventBusName,
      STRIPE_API_KEY_PARAM: secrets.paymentStripeKey,
      STRIPE_WEBHOOK_SECRET_PARAM: secrets.stripeWebhookSecret,
    });
    props.eventBus.grantPutEventsTo(this.paymentMicroservice);
    paymentStripeKey.grantRead(this.paymentMicroservice);
    stripeWebhookSecret.grantRead(this.paymentMicroservice);

    // Ordering microservice: turns CheckoutCompleted events into orders.
    this.orderingMicroservice = createFunction("ordering", { TABLE_NAME: table.tableName });
    allowItems(this.orderingMicroservice, ["GetItem", "PutItem"], ["ORDER#"]);
    allowIndexQuery(this.orderingMicroservice, GSI1, ["CUSTOMER#"]);
    allowIndexQuery(this.orderingMicroservice, GSI2, ["FULFILLMENT#"]);

    // Storefront microservice: rebuilds the static storefront when it goes out of date.
    this.storefrontMicroservice = createFunction("storefront", {});
  }
}
