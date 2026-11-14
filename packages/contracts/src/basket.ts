import { z } from "zod";

export const MAX_BASKET_LINES = 30;
export const MAX_QUANTITY_PER_LINE = 10;

/** Baskets are anonymous. The id is a random UUID the browser generates and keeps. */
export const basketIdSchema = z.uuid();

export const basketItemSchema = z.object({
  productId: z.string().min(1).max(80),
  sku: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_LINE),
});
export type BasketItem = z.infer<typeof basketItemSchema>;

export const putBasketRequestSchema = z.object({
  items: z.array(basketItemSchema).max(MAX_BASKET_LINES),
});
export type PutBasketRequest = z.infer<typeof putBasketRequestSchema>;

/** A basket line with current catalog pricing applied by the server. */
export type PricedLine = BasketItem & {
  productName: string;
  variantTitle: string;
  unitPriceCents: number;
  lineTotalCents: number;
  image: string | null;
};

export type PricedBasket = {
  id: string;
  lines: PricedLine[];
  subtotalCents: number;
  /** Shipping for this subtotal, so the bag can show it before checkout. */
  shippingCents: number;
  /** Subtotal at which shipping becomes free. */
  freeShippingThresholdCents: number;
  /** Items that were in the basket but are no longer sold. They are removed from the basket. */
  removed: BasketItem[];
};

export type CheckoutResponse = {
  /** Stripe-hosted checkout page to send the shopper to. */
  url: string;
};
