import { beforeEach, describe, expect, it } from "vitest";
import { createOrderService } from "../../../src/ordering/application/order-service";
import { orderIdForSession } from "../../../src/ordering/domain/order";
import { inMemoryOrders } from "../fakes";
import { owner, paidCheckout } from "../fixtures";

const orderId = orderIdForSession(paidCheckout.checkoutSessionId);

let orders: ReturnType<typeof inMemoryOrders>;
let service: ReturnType<typeof createOrderService>;

beforeEach(() => {
  orders = inMemoryOrders();
  service = createOrderService({ orders, now: () => new Date("2026-11-14T12:00:05.000Z") });
});

describe("recording a paid checkout", () => {
  it("creates an unfulfilled order", async () => {
    expect(await service.recordPaidCheckout(paidCheckout)).toEqual({ orderId, outcome: "created" });
    const queue = await service.listByFulfillmentStatus("unfulfilled", { limit: 10 });
    expect(queue.items).toEqual([expect.objectContaining({ id: orderId })]);
  });

  it("changes nothing when the same checkout is delivered again", async () => {
    await service.recordPaidCheckout(paidCheckout);
    const original = await service.getOrder(orderId);

    const redelivery = await service.recordPaidCheckout({ ...paidCheckout, email: "changed@example.com" });

    expect(redelivery).toEqual({ orderId, outcome: "already_exists" });
    expect(await service.getOrder(orderId)).toEqual(original);
    expect(orders.stored.size).toBe(1);
  });

  it("fails loudly if a different payment maps to an existing order number", async () => {
    await service.recordPaidCheckout(paidCheckout);
    const existing = orders.stored.get(orderId)!;
    orders.stored.set(orderId, { ...existing, checkoutSessionId: "cs_test_someone_else" });

    await expect(service.recordPaidCheckout(paidCheckout)).rejects.toThrow(/collision/);
  });
});

describe("listing orders", () => {
  const checkoutAt = (sessionId: string, paidAt: string, email = paidCheckout.email) => ({
    ...paidCheckout,
    checkoutSessionId: sessionId,
    paidAt,
    email,
  });

  beforeEach(async () => {
    await service.recordPaidCheckout(checkoutAt("cs_first", "2026-11-01T10:00:00.000Z"));
    await service.recordPaidCheckout(checkoutAt("cs_second", "2026-11-02T10:00:00.000Z"));
    await service.recordPaidCheckout(checkoutAt("cs_other", "2026-11-03T10:00:00.000Z", "someone-else@example.com"));
  });

  it("shows a customer their own orders, newest first, whatever the email's capitalisation", async () => {
    const page = await service.listForCustomer("BUYER@example.com", { limit: 10 });

    expect(page.items.map((order) => order.checkoutSessionId)).toEqual(["cs_second", "cs_first"]);
    expect(page.nextCursor).toBeNull();
  });

  it("pages through a list with the cursor from the previous page", async () => {
    const first = await service.listByFulfillmentStatus("unfulfilled", { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.listByFulfillmentStatus("unfulfilled", { limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });
});

describe("fulfilling an order", () => {
  const usps = { carrier: "USPS", trackingNumber: "9400111899223197428490" };
  const queueOf = async (status: "unfulfilled" | "processing" | "shipped" | "delivered") =>
    (await service.listByFulfillmentStatus(status, { limit: 10 })).items.map((order) => order.id);

  beforeEach(async () => {
    await service.recordPaidCheckout(paidCheckout);
  });

  it("moves the order from one work queue to the next", async () => {
    await service.takeFulfillmentStep(orderId, { step: "ordered-from-vendor", vendorOrderReference: null }, owner);

    expect(await queueOf("unfulfilled")).toEqual([]);
    expect(await queueOf("processing")).toEqual([orderId]);
  });

  it("returns and stores the order as it is after the step", async () => {
    await service.takeFulfillmentStep(orderId, { step: "ordered-from-vendor", vendorOrderReference: "V-1001" }, owner);
    const shipped = await service.takeFulfillmentStep(orderId, { step: "shipped", shipment: usps }, owner);

    expect(shipped).toMatchObject({ fulfillmentStatus: "shipped", shipment: usps, shippedAt: "2026-11-14T12:00:05.000Z" });
    expect(await service.getOrder(orderId)).toEqual(shipped);
  });

  it("refuses a step out of order and leaves the order as it was", async () => {
    const before = await service.getOrder(orderId);

    await expect(service.takeFulfillmentStep(orderId, { step: "delivered" }, owner)).rejects.toMatchObject({
      kind: "conflict",
      message: expect.stringContaining("cannot be marked as delivered"),
    });
    expect(await service.getOrder(orderId)).toEqual(before);
  });

  it("refuses the same step twice", async () => {
    const orderIt = { step: "ordered-from-vendor", vendorOrderReference: null } as const;
    await service.takeFulfillmentStep(orderId, orderIt, owner);

    await expect(service.takeFulfillmentStep(orderId, orderIt, owner)).rejects.toMatchObject({ kind: "conflict" });
  });

  it("tells the second of two people working the same order that it changed", async () => {
    // Someone else moves the order on between this request reading it and storing its change.
    const { saveFulfillment } = orders;
    orders.saveFulfillment = async (order, from, activity) => {
      orders.stored.set(order.id, { ...orders.stored.get(order.id)!, fulfillmentStatus: "processing" });
      return saveFulfillment(order, from, activity);
    };

    await expect(
      service.takeFulfillmentStep(orderId, { step: "ordered-from-vendor", vendorOrderReference: "MINE" }, owner),
    ).rejects.toMatchObject({ kind: "conflict", message: expect.stringContaining("changed by someone else") });
    expect(orders.stored.get(orderId)?.vendorOrderReference).toBeNull();
  });

  it("corrects the tracking of an order that is on its way, and of no other", async () => {
    const ups = { carrier: "UPS", trackingNumber: "1Z999AA10123456784" };
    await expect(service.correctShipment(orderId, ups, owner)).rejects.toMatchObject({ kind: "conflict" });

    await service.takeFulfillmentStep(orderId, { step: "ordered-from-vendor", vendorOrderReference: null }, owner);
    await service.takeFulfillmentStep(orderId, { step: "shipped", shipment: usps }, owner);

    expect((await service.correctShipment(orderId, ups, owner)).shipment).toEqual(ups);
  });

  it("reports an unknown order as not found", async () => {
    await expect(service.takeFulfillmentStep("LB-NOPE", { step: "delivered" }, owner)).rejects.toMatchObject({ kind: "not_found" });
  });

  it("records each step in the activity log: who, when, which order, and what was typed in", async () => {
    const ups = { carrier: "UPS", trackingNumber: "1Z999AA10123456784" };
    await service.takeFulfillmentStep(orderId, { step: "ordered-from-vendor", vendorOrderReference: "V-1001" }, owner);
    await service.takeFulfillmentStep(orderId, { step: "shipped", shipment: usps }, owner);
    await service.correctShipment(orderId, ups, owner);
    await service.takeFulfillmentStep(orderId, { step: "delivered" }, owner);

    expect(orders.recorded.map(({ action, note }) => [action, note])).toEqual([
      ["order.ordered-from-vendor", "Vendor order V-1001"],
      ["order.shipped", "USPS 9400111899223197428490"],
      ["order.shipment-corrected", "UPS 1Z999AA10123456784"],
      ["order.delivered", null],
    ]);
    for (const entry of orders.recorded) {
      expect(entry).toMatchObject({ actor: owner, at: "2026-11-14T12:00:05.000Z", subject: { kind: "order", id: orderId, label: orderId } });
    }
  });

  it("records nothing for a step that was refused, or for an order someone else changed first", async () => {
    await service.takeFulfillmentStep(orderId, { step: "delivered" }, owner).catch(() => {});
    orders.stored.set(orderId, { ...orders.stored.get(orderId)!, fulfillmentStatus: "unfulfilled" });
    const { saveFulfillment } = orders;
    orders.saveFulfillment = async (order, _from, activity) => saveFulfillment(order, "shipped", activity);
    await service.takeFulfillmentStep(orderId, { step: "ordered-from-vendor", vendorOrderReference: null }, owner).catch(() => {});

    expect(orders.recorded).toEqual([]);
  });

  it("does not record a paid checkout: that is the shopper's doing, not a back-office change", async () => {
    expect(orders.recorded).toEqual([]);
  });
});

describe("reading orders", () => {
  it("finds the confirmation for a checkout session", async () => {
    await service.recordPaidCheckout(paidCheckout);
    expect(await service.getConfirmation(paidCheckout.checkoutSessionId)).toMatchObject({ id: orderId });
  });

  it("reports unknown orders and sessions as not found", async () => {
    await expect(service.getOrder("LB-NOPE")).rejects.toMatchObject({ kind: "not_found" });
    await expect(service.getConfirmation("cs_unknown")).rejects.toMatchObject({ kind: "not_found" });
  });
});
