import { fulfillmentStatusSchema, type Order, type Page } from "@luxebaddie/contracts";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { z } from "zod";
import { backOfficeRoutes, type HttpHandler, httpRouter, pathParam } from "../../shared/adapters/api-gateway";
import { invalid } from "../../shared/errors";
import type { OrderService } from "../application/order-service";
import type { PageRequest } from "../application/ports";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const pageSizeSchema = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);

/**
 * Public (order confirmation page):
 *   GET /order/session/{sessionId}        the order for a checkout session
 * Back office (under /admin and /backoffice, see shared/back-office.ts):
 *   GET /order                            the fulfillment queue: ?fulfillmentStatus= (default unfulfilled), oldest first
 *   GET /order/{id}
 *   GET /customer/{email}/order           one customer's orders, newest first
 *
 * Lists are paged: pass ?limit= (default 25, at most 100) and the previous
 * response's nextCursor as ?cursor=.
 */
export function orderHttpHandler(orders: OrderService): HttpHandler {
  return httpRouter({
    "GET /order/session/{sessionId}": async (event) => ({
      body: { order: await orders.getConfirmation(pathParam(event, "sessionId")) },
    }),

    ...backOfficeRoutes({
      "GET /order": async (event) => {
        const status = fulfillmentStatusSchema.safeParse(event.queryStringParameters?.fulfillmentStatus ?? "unfulfilled");
        if (!status.success) throw invalid("Unknown fulfillmentStatus");
        return { body: toListResponse(await orders.listByFulfillmentStatus(status.data, pageRequest(event))) };
      },

      "GET /order/{id}": async (event) => ({
        body: { order: await orders.getOrder(pathParam(event, "id")) },
      }),

      "GET /customer/{email}/order": async (event) => ({
        body: toListResponse(await orders.listForCustomer(pathParam(event, "email"), pageRequest(event))),
      }),
    }),
  });
}

function pageRequest(event: APIGatewayProxyEvent): PageRequest {
  const limit = pageSizeSchema.safeParse(event.queryStringParameters?.limit);
  if (!limit.success) throw invalid(`limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`);
  return { limit: limit.data, cursor: event.queryStringParameters?.cursor };
}

const toListResponse = (page: Page<Order>) => ({ orders: page.items, nextCursor: page.nextCursor });
