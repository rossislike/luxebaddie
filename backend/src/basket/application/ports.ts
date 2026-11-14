import type { BasketItem, PricedBasket, Product } from "@luxebaddie/contracts";

/** Where baskets are kept. A basket that was never saved is simply empty. */
export interface BasketRepository {
  findItems(basketId: string): Promise<BasketItem[]>;
  saveItems(basketId: string, items: BasketItem[]): Promise<void>;
  remove(basketId: string): Promise<void>;
}

/** The basket service's read-only view of the product catalog. */
export interface Catalog {
  findProducts(productIds: string[]): Promise<Map<string, Product>>;
}

/** Takes payment for a basket. Implemented by the Stripe adapter. */
export interface CheckoutGateway {
  /**
   * Starts a hosted checkout and returns the URL to send the shopper to.
   * `returnTo` is the storefront the shopper came from, e.g. http://localhost:3000;
   * they land back there after paying. Without it they return to the stage's main storefront.
   */
  startCheckout(basket: PricedBasket, returnTo?: string): Promise<string>;
}
