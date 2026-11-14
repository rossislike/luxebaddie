import { checkoutCompletedSchema } from "@luxebaddie/contracts";
import { eventQueueConsumer, type QueueHandler } from "../../shared/adapters/event-queue";
import type { OrderService } from "../application/order-service";

/** Reacts to CheckoutCompleted: the paid checkout is recorded as an order. */
export function orderQueueHandler(orders: OrderService): QueueHandler {
  return eventQueueConsumer(checkoutCompletedSchema, async (checkout) => {
    const result = await orders.recordPaidCheckout(checkout);
    console.log("Processed CheckoutCompleted", { checkoutSessionId: checkout.checkoutSessionId, ...result });
  });
}
