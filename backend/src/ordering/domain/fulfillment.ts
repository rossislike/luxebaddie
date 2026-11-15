import type { FulfillmentStatus, FulfillmentStep, Order, Shipment } from "@luxebaddie/contracts";

/**
 * Fulfilling an order: getting what was paid for to the customer. With a
 * dropship vendor that is three steps, always in this order:
 *
 *   unfulfilled --ordered-from-vendor--> processing --shipped--> shipped --delivered--> delivered
 *
 * An order cannot skip a step or go back one. That is what keeps the work
 * queues honest: an order is in exactly one, and only moves forward.
 */
type StepName = FulfillmentStep["step"];

const STATUS_BEFORE: Record<StepName, FulfillmentStatus> = {
  "ordered-from-vendor": "unfulfilled",
  shipped: "processing",
  delivered: "shipped",
};

const STATUS_AFTER: Record<StepName, FulfillmentStatus> = {
  "ordered-from-vendor": "processing",
  shipped: "shipped",
  delivered: "delivered",
};

const STATUS_IN_WORDS: Record<FulfillmentStatus, string> = {
  unfulfilled: "has not been ordered from the vendor yet",
  processing: "has been ordered from the vendor and has not shipped yet",
  shipped: "has already shipped",
  delivered: "has already been delivered",
};

const STEP_IN_WORDS: Record<StepName, string> = {
  "ordered-from-vendor": "marked as ordered from the vendor",
  shipped: "marked as shipped",
  delivered: "marked as delivered",
};

/** Why this step cannot be taken on this order right now, in words for the person trying. Null if it can. */
export function whyStepIsRefused(order: Order, step: FulfillmentStep): string | null {
  if (order.fulfillmentStatus === STATUS_BEFORE[step.step]) return null;
  return `Order ${order.id} ${STATUS_IN_WORDS[order.fulfillmentStatus]}, so it cannot be ${STEP_IN_WORDS[step.step]}.`;
}

/** The order after the step. Only for a step whyStepIsRefused has no objection to. */
export function takeStep(order: Order, step: FulfillmentStep, at: Date): Order {
  const moved = { ...order, fulfillmentStatus: STATUS_AFTER[step.step] };
  const when = at.toISOString();
  switch (step.step) {
    case "ordered-from-vendor":
      return { ...moved, orderedFromVendorAt: when, vendorOrderReference: step.vendorOrderReference || null };
    case "shipped":
      return { ...moved, shippedAt: when, shipment: step.shipment };
    case "delivered":
      return { ...moved, deliveredAt: when };
  }
}

/** Why the carrier or tracking number cannot be changed on this order. Null if they can. */
export function whyShipmentCorrectionIsRefused(order: Order): string | null {
  if (order.fulfillmentStatus === "shipped") return null;
  return `Order ${order.id} ${STATUS_IN_WORDS[order.fulfillmentStatus]}. Tracking can only be corrected while an order is on its way.`;
}

/** The order with a mistyped carrier or tracking number put right. It stays shipped, with its original ship date. */
export function correctShipment(order: Order, shipment: Shipment): Order {
  return { ...order, shipment };
}
