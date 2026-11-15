import type { FulfillmentStatus, FulfillmentStep, Order } from "@luxebaddie/contracts";
import { describe, expect, it } from "vitest";
import {
  correctShipment,
  takeStep,
  whyShipmentCorrectionIsRefused,
  whyStepIsRefused,
} from "../../../src/ordering/domain/fulfillment";
import { orderFromCheckout } from "../../../src/ordering/domain/order";
import { paidCheckout } from "../fixtures";

const AT = new Date("2026-11-15T09:30:00.000Z");
const usps = { carrier: "USPS", trackingNumber: "9400111899223197428490" };

const orderedFromVendor: FulfillmentStep = { step: "ordered-from-vendor", vendorOrderReference: "V-1001" };
const shipped: FulfillmentStep = { step: "shipped", shipment: usps };
const delivered: FulfillmentStep = { step: "delivered" };
const steps = [orderedFromVendor, shipped, delivered];

const unfulfilled = orderFromCheckout(paidCheckout, new Date("2026-11-14T12:00:05.000Z"));
const after = (...taken: FulfillmentStep[]): Order => taken.reduce((order, step) => takeStep(order, step, AT), unfulfilled);

const ordersByStatus: Record<FulfillmentStatus, Order> = {
  unfulfilled,
  processing: after(orderedFromVendor),
  shipped: after(orderedFromVendor, shipped),
  delivered: after(orderedFromVendor, shipped, delivered),
};

describe("fulfilling an order", () => {
  it("starts with nothing done", () => {
    expect(unfulfilled).toMatchObject({
      fulfillmentStatus: "unfulfilled",
      vendorOrderReference: null,
      orderedFromVendorAt: null,
      shipment: null,
      shippedAt: null,
      deliveredAt: null,
    });
  });

  it("records the vendor's reference and the time when it is ordered from the vendor", () => {
    expect(after(orderedFromVendor)).toMatchObject({
      fulfillmentStatus: "processing",
      vendorOrderReference: "V-1001",
      orderedFromVendorAt: AT.toISOString(),
    });
  });

  it("treats a blank vendor reference as none", () => {
    expect(after({ step: "ordered-from-vendor", vendorOrderReference: "" }).vendorOrderReference).toBeNull();
  });

  it("records the carrier, the tracking number and the time when it ships", () => {
    expect(after(orderedFromVendor, shipped)).toMatchObject({
      fulfillmentStatus: "shipped",
      shipment: usps,
      shippedAt: AT.toISOString(),
    });
  });

  it("records the time when it is delivered, and keeps everything recorded before", () => {
    expect(after(orderedFromVendor, shipped, delivered)).toMatchObject({
      fulfillmentStatus: "delivered",
      vendorOrderReference: "V-1001",
      shipment: usps,
      deliveredAt: AT.toISOString(),
    });
  });

  it("changes nothing about what was bought", () => {
    const { items, totalCents, email, shippingAddress } = after(orderedFromVendor, shipped, delivered);

    expect({ items, totalCents, email, shippingAddress }).toEqual({
      items: unfulfilled.items,
      totalCents: unfulfilled.totalCents,
      email: unfulfilled.email,
      shippingAddress: unfulfilled.shippingAddress,
    });
  });
});

describe("the order of the steps", () => {
  const NEXT_STEP: Record<FulfillmentStatus, FulfillmentStep["step"] | null> = {
    unfulfilled: "ordered-from-vendor",
    processing: "shipped",
    shipped: "delivered",
    delivered: null,
  };

  // Every status against every step: exactly one step is ever allowed.
  it.each(
    Object.entries(ordersByStatus).flatMap(([status, order]) =>
      steps.map((step) => ({ status, order, step, allowed: NEXT_STEP[status as FulfillmentStatus] === step.step })),
    ),
  )("an order that is $status can be $step.step: $allowed", ({ order, step, allowed }) => {
    expect(whyStepIsRefused(order, step) === null).toBe(allowed);
  });

  it("says why, in plain words, when a step is skipped", () => {
    expect(whyStepIsRefused(unfulfilled, shipped)).toBe(
      `Order ${unfulfilled.id} has not been ordered from the vendor yet, so it cannot be marked as shipped.`,
    );
  });

  it("says why when a step would go backwards", () => {
    expect(whyStepIsRefused(ordersByStatus.delivered, orderedFromVendor)).toBe(
      `Order ${unfulfilled.id} has already been delivered, so it cannot be marked as ordered from the vendor.`,
    );
  });
});

describe("correcting a shipment", () => {
  const ups = { carrier: "UPS", trackingNumber: "1Z999AA10123456784" };

  it("replaces the carrier and tracking number and keeps the ship date", () => {
    const corrected = correctShipment(ordersByStatus.shipped, ups);

    expect(corrected).toMatchObject({ fulfillmentStatus: "shipped", shipment: ups, shippedAt: AT.toISOString() });
  });

  it.each(["unfulfilled", "processing", "delivered"] as const)("is refused for an order that is %s", (status) => {
    expect(whyShipmentCorrectionIsRefused(ordersByStatus[status])).toMatch(/Tracking can only be corrected while an order is on its way/);
  });

  it("is allowed for an order that is on its way", () => {
    expect(whyShipmentCorrectionIsRefused(ordersByStatus.shipped)).toBeNull();
  });
});
