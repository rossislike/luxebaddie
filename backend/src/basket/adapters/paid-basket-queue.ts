import { checkoutCompletedSchema } from "@luxebaddie/contracts";
import { eventQueueConsumer, type QueueHandler } from "../../shared/adapters/event-queue";
import type { BasketService } from "../application/basket-service";

/**
 * Reacts to CheckoutCompleted: the basket that was just paid for is emptied.
 * Discarding a basket twice is harmless, so redelivered events are safe.
 */
export function paidBasketQueueHandler(basket: BasketService): QueueHandler {
  return eventQueueConsumer(checkoutCompletedSchema, async ({ basketId }) => {
    if (basketId) await basket.discardBasket(basketId);
  });
}
