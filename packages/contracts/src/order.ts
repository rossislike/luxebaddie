import { z } from "zod";

export const addressSchema = z.object({
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
});
export type Address = z.infer<typeof addressSchema>;

export const orderItemSchema = z.object({
  productId: z.string(),
  sku: z.string(),
  /** Product name and variant as the customer saw them at purchase time. */
  description: z.string(),
  unitPriceCents: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const FULFILLMENT_STATUSES = ["unfulfilled", "processing", "shipped", "delivered"] as const;
export const fulfillmentStatusSchema = z.enum(FULFILLMENT_STATUSES);
export type FulfillmentStatus = z.infer<typeof fulfillmentStatusSchema>;

export const orderSchema = z.object({
  /** Customer-facing order number, e.g. LB-7K3M9Q2XAB. */
  id: z.string(),
  checkoutSessionId: z.string(),
  paymentIntentId: z.string().nullable(),
  fulfillmentStatus: fulfillmentStatusSchema,
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
  /** ISO timestamps. */
  paidAt: z.string(),
  createdAt: z.string(),
});
export type Order = z.infer<typeof orderSchema>;

/** What the order confirmation page is allowed to see. */
export type OrderConfirmation = Pick<
  Order,
  | "id"
  | "email"
  | "shippingName"
  | "shippingAddress"
  | "items"
  | "subtotalCents"
  | "discountCents"
  | "shippingCents"
  | "taxCents"
  | "totalCents"
  | "paidAt"
>;

/** One page of a list, with the cursor to pass back for the next page (null on the last page). */
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};
