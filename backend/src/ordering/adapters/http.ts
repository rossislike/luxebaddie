import {
  fulfillmentStatusSchema,
  fulfillmentStepSchema,
  type Order,
  type Page,
  shipmentSchema,
} from "@luxebaddie/contracts";
import {
  actorOf,
  backOfficeRoutes,
  type HttpHandler,
  httpRouter,
  parseBody,
  pathParam,
} from "../../shared/adapters/api-gateway";
import { pageRequest } from "../../shared/adapters/paging";
import { invalid } from "../../shared/errors";
import type { OrderService } from "../application/order-service";

/**
 * Public (order confirmation page):
 *   GET /order/session/{sessionId}        the order for a checkout session
 * Back office (under /admin and /backoffice, see shared/back-office.ts):
 *   GET /order                            the fulfillment queue: ?fulfillmentStatus= (default unfulfilled), oldest first
 *   GET /order/{id}
 *   POST /order/{id}/fulfillment-step     move the order one step on: ordered from the vendor, shipped, delivered
 *   PUT /order/{id}/shipment              correct the carrier or tracking number of an order that is on its way
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

      "POST /order/{id}/fulfillment-step": async (event) => ({
        body: {
          order: await orders.takeFulfillmentStep(pathParam(event, "id"), parseBody(event, fulfillmentStepSchema), actorOf(event)),
        },
      }),

      "PUT /order/{id}/shipment": async (event) => ({
        body: { order: await orders.correctShipment(pathParam(event, "id"), parseBody(event, shipmentSchema), actorOf(event)) },
      }),

      "GET /customer/{email}/order": async (event) => ({
        body: toListResponse(await orders.listForCustomer(pathParam(event, "email"), pageRequest(event))),
      }),
    }),
  });
}

const toListResponse = (page: Page<Order>) => ({ orders: page.items, nextCursor: page.nextCursor });
