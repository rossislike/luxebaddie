import type { BasketItem, PricedBasket } from "@luxebaddie/contracts";
import { conflict } from "../../shared/errors";
import { itemsOf, priceBasket } from "../domain/pricing";
import type { BasketRepository, Catalog, CheckoutGateway } from "./ports";

interface BasketPorts {
  baskets: BasketRepository;
  catalog: Catalog;
  checkout: CheckoutGateway;
}

/** Basket use cases: the shopping bag and the hand-off to payment. */
export function createBasketService({ baskets, catalog, checkout }: BasketPorts) {
  async function price(basketId: string, items: BasketItem[]): Promise<PricedBasket> {
    const products = await catalog.findProducts(items.map((item) => item.productId));
    return priceBasket(basketId, items, products);
  }

  const viewBasket = async (basketId: string) => price(basketId, await baskets.findItems(basketId));

  return {
    viewBasket,

    /** Replaces the basket's contents, keeping only what is for sale. */
    async replaceItems(basketId: string, items: BasketItem[]): Promise<PricedBasket> {
      const basket = await price(basketId, items);
      await baskets.saveItems(basketId, itemsOf(basket));
      return basket;
    },

    discardBasket: (basketId: string) => baskets.remove(basketId),

    /** Returns the URL of the hosted checkout page for this basket. */
    async startCheckout(basketId: string): Promise<string> {
      const basket = await viewBasket(basketId);
      if (basket.removed.length > 0) {
        // Never charge for a bag that differs from what the shopper last saw.
        await baskets.saveItems(basketId, itemsOf(basket));
        throw conflict("Some items in your bag are no longer available", basket);
      }
      if (basket.lines.length === 0) throw conflict("Your bag is empty", basket);
      return checkout.startCheckout(basket);
    },
  };
}

export type BasketService = ReturnType<typeof createBasketService>;
