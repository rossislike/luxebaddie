import { z } from "zod";
import { addressSchema, orderItemSchema } from "./order";

/**
 * Events on the LuxeBaddie EventBridge bus. Each event has a `source` (the
 * service that publishes it) and a `detailType` (what happened). New
 * automations subscribe to these with an EventBridge rule; publishers never
 * need to know who is listening.
 */
export const EVENTS = {
  /** A shopper paid. Published by the payment service once Stripe confirms the payment. */
  checkoutCompleted: {
    source: "com.luxebaddie.payment",
    detailType: "CheckoutCompleted",
  },
  /**
   * A pay-later payment was declined after the shopper left checkout. Nothing
   * was charged and no order exists. Published by the payment service.
   */
  checkoutPaymentFailed: {
    source: "com.luxebaddie.payment",
    detailType: "CheckoutPaymentFailed",
  },
  /**
   * A product was added, edited or removed. Published by the product service
   * from the table's change stream, so it can never disagree with what was saved.
   */
  catalogChanged: {
    source: "com.luxebaddie.product",
    detailType: "CatalogChanged",
  },
} as const;

export const checkoutCompletedSchema = z.object({
  checkoutSessionId: z.string().min(1),
  paymentIntentId: z.string().nullable(),
  basketId: z.string().nullable(),
  email: z.string().nullable(),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  shippingName: z.string().nullable(),
  shippingAddress: addressSchema.nullable(),
  items: z.array(orderItemSchema).min(1),
  subtotalCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  taxCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  currency: z.string(),
  /** ISO timestamp of when Stripe confirmed the payment. */
  paidAt: z.string(),
});
export type CheckoutCompleted = z.infer<typeof checkoutCompletedSchema>;

export const checkoutPaymentFailedSchema = z.object({
  checkoutSessionId: z.string().min(1),
  basketId: z.string().nullable(),
  email: z.string().nullable(),
  customerName: z.string().nullable(),
});
export type CheckoutPaymentFailed = z.infer<typeof checkoutPaymentFailedSchema>;

export const catalogChangedSchema = z.object({
  productId: z.string().min(1),
  change: z.enum(["saved", "removed"]),
});
export type CatalogChanged = z.infer<typeof catalogChangedSchema>;
