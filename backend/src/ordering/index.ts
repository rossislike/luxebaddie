/**
 * Ordering microservice: turns paid checkouts into orders and serves them.
 * Composition root - the only file that knows which concrete adapters are used.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../shared/adapters/aws-clients";
import { requireEnv } from "../shared/env";
import { dynamoDbOrderRepository } from "./adapters/dynamodb-order-repository";
import { orderHttpHandler } from "./adapters/http";
import { orderQueueHandler } from "./adapters/order-queue";
import { createOrderService } from "./application/order-service";

const orderService = createOrderService({
  orders: dynamoDbOrderRepository(createDocumentClient(), requireEnv("TABLE_NAME")),
});

const handleHttp = orderHttpHandler(orderService);
const handleQueue = orderQueueHandler(orderService);

export function handler(
  event: APIGatewayProxyEvent | SQSEvent,
): Promise<APIGatewayProxyResult | SQSBatchResponse> {
  return "Records" in event ? handleQueue(event) : handleHttp(event);
}
