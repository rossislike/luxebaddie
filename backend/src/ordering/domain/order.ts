import { createHash } from "node:crypto";
import type { CheckoutCompleted, Order, OrderConfirmation } from "@luxebaddie/contracts";

// Crockford base32: no I, L, O or U, so order numbers are easy to read aloud.
const ORDER_NUMBER_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ORDER_NUMBER_LENGTH = 10;
const BITS_PER_CHARACTER = 5n;

/**
 * Derives the customer-facing order number from the checkout session id.
 * Because the same session always yields the same number, processing a
 * payment event twice can never create two orders.
 */
export function orderIdForSession(checkoutSessionId: string): string {
  const digest = createHash("sha256").update(checkoutSessionId).digest();
  let bits = digest.readBigUInt64BE();

  let code = "";
  for (let i = 0; i < ORDER_NUMBER_LENGTH; i++) {
    code += ORDER_NUMBER_ALPHABET[Number(bits & 31n)];
    bits >>= BITS_PER_CHARACTER;
  }
  return `LB-${code}`;
}

/** An order nothing has been done about yet. Also what an order stored before fulfillment was tracked reads as. */
export const NOT_YET_FULFILLED = {
  fulfillmentStatus: "unfulfilled",
  vendorOrderReference: null,
  orderedFromVendorAt: null,
  shipment: null,
  shippedAt: null,
  deliveredAt: null,
} satisfies Partial<Order>;

/** A paid checkout becomes an order waiting to be fulfilled. */
export function orderFromCheckout(checkout: CheckoutCompleted, createdAt: Date): Order {
  const { basketId: _basketId, ...purchase } = checkout;
  return {
    ...purchase,
    id: orderIdForSession(checkout.checkoutSessionId),
    ...NOT_YET_FULFILLED,
    createdAt: createdAt.toISOString(),
  };
}

/** What the buyer may see on the confirmation page: no internal or payment identifiers. */
export function confirmationOf(order: Order): OrderConfirmation {
  return {
    id: order.id,
    email: order.email,
    shippingName: order.shippingName,
    shippingAddress: order.shippingAddress,
    items: order.items,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    paidAt: order.paidAt,
  };
}
