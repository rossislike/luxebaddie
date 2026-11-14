/**
 * Basket microservice: the shopping bag and the hand-off to Stripe Checkout.
 * Composition root - the only file that knows which concrete adapters are used.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../shared/adapters/aws-clients";
import { createSecretReader } from "../shared/adapters/ssm-secrets";
import { createStripeProvider } from "../shared/adapters/stripe-client";
import { requireEnv } from "../shared/env";
import { dynamoDbBasketRepository } from "./adapters/dynamodb-basket-repository";
import { dynamoDbCatalog } from "./adapters/dynamodb-catalog";
import { basketHttpHandler } from "./adapters/http";
import { paidBasketQueueHandler } from "./adapters/paid-basket-queue";
import { stripeCheckoutGateway } from "./adapters/stripe-checkout-gateway";
import { createBasketService } from "./application/basket-service";

const ddb = createDocumentClient();
const getStripe = createStripeProvider(createSecretReader(), requireEnv("STRIPE_API_KEY_PARAM"));

const tableName = requireEnv("TABLE_NAME");

const basketService = createBasketService({
  baskets: dynamoDbBasketRepository(ddb, tableName),
  catalog: dynamoDbCatalog(ddb, tableName),
  checkout: stripeCheckoutGateway(getStripe, {
    stage: requireEnv("STAGE"),
    storefrontUrl: requireEnv("STOREFRONT_URL"),
    automaticTax: process.env.STRIPE_AUTOMATIC_TAX === "true",
  }),
});

const handleHttp = basketHttpHandler(basketService);
const handleQueue = paidBasketQueueHandler(basketService);

export function handler(
  event: APIGatewayProxyEvent | SQSEvent,
): Promise<APIGatewayProxyResult | SQSBatchResponse> {
  return "Records" in event ? handleQueue(event) : handleHttp(event);
}
