import { describe, expect, it } from "vitest";
import { confirmationOf, orderFromCheckout, orderIdForSession } from "../../../src/ordering/domain/order";
import { paidCheckout } from "../fixtures";

describe("order numbers", () => {
  it("are short and easy to read aloud", () => {
    expect(orderIdForSession("cs_test_abc123")).toMatch(/^LB-[0-9A-HJKMNP-TV-Z]{10}$/);
  });

  it("are always the same for the same checkout session", () => {
    expect(orderIdForSession("cs_test_abc123")).toBe(orderIdForSession("cs_test_abc123"));
  });

  it("differ between checkout sessions", () => {
    expect(orderIdForSession("cs_test_abc123")).not.toBe(orderIdForSession("cs_test_abc124"));
  });
});

describe("orders", () => {
  const order = orderFromCheckout(paidCheckout, new Date("2026-11-14T12:00:05.000Z"));

  it("start unfulfilled, numbered from the checkout session", () => {
    expect(order).toMatchObject({
      id: orderIdForSession(paidCheckout.checkoutSessionId),
      fulfillmentStatus: "unfulfilled",
      totalCents: 10_795,
      paidAt: "2026-11-14T12:00:00.000Z",
      createdAt: "2026-11-14T12:00:05.000Z",
    });
    expect(order).not.toHaveProperty("basketId");
  });

  it("show the buyer a confirmation without payment identifiers", () => {
    const confirmation = confirmationOf(order);
    expect(confirmation).toMatchObject({ id: order.id, email: "buyer@example.com", totalCents: 10_795 });
    expect(confirmation).not.toHaveProperty("paymentIntentId");
    expect(confirmation).not.toHaveProperty("checkoutSessionId");
  });
});
