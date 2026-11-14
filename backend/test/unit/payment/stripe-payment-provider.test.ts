import { checkoutCompletedSchema } from "@luxebaddy/contracts";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripePaymentProvider, toCheckoutCompleted } from "../../../src/payment/adapters/stripe-payment-provider";
import { BASKET_ID } from "../fixtures";

const WEBHOOK_SECRET = "whsec_unit_test";
const stripe = new Stripe("rk_test_unit");

const session = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "cs_test_abc123",
    payment_status: "paid",
    payment_intent: "pi_123",
    metadata: { basketId: BASKET_ID, stage: "dev" },
    customer_details: { email: "buyer@example.com", name: "Bea Buyer", phone: "+15555550100" },
    collected_information: {
      shipping_details: {
        name: "Bea Buyer",
        address: { line1: "1 Main St", line2: null, city: "Atlanta", state: "GA", postal_code: "30301", country: "US" },
      },
    },
    amount_subtotal: 13_000,
    amount_total: 13_795,
    total_details: { amount_discount: 0, amount_shipping: 795, amount_tax: 0 },
    currency: "usd",
    ...overrides,
  }) as unknown as Stripe.Checkout.Session;

const lineItem = (metadata: Record<string, string>, sku: string, unitAmount: number, quantity: number) =>
  ({
    id: `li_${sku}`,
    description: `Item ${sku}`,
    quantity,
    price: { unit_amount: unitAmount, product: { id: "prod_1", metadata } },
  }) as unknown as Stripe.LineItem;

const wigLine = lineItem({ productId: "test-wig", sku: "TW-16" }, "TW-16", 10_000, 1);
const lashLine = lineItem({ productId: "test-lashes", sku: "TL" }, "TL", 1_500, 2);

describe("translating a paid Stripe session", () => {
  const checkout = toCheckoutCompleted(session(), [wigLine, lashLine], new Date("2026-11-14T12:00:00.000Z"));

  it("produces a valid CheckoutCompleted event", () => {
    expect(checkoutCompletedSchema.parse(checkout)).toEqual(checkout);
  });

  it("carries the buyer, shipping address and totals", () => {
    expect(checkout).toMatchObject({
      checkoutSessionId: "cs_test_abc123",
      paymentIntentId: "pi_123",
      basketId: BASKET_ID,
      email: "buyer@example.com",
      shippingAddress: { line1: "1 Main St", city: "Atlanta", state: "GA", postalCode: "30301", country: "US" },
      subtotalCents: 13_000,
      shippingCents: 795,
      totalCents: 13_795,
      paidAt: "2026-11-14T12:00:00.000Z",
    });
  });

  it("recovers each line's product and SKU from its metadata", () => {
    expect(checkout.items).toEqual([
      { productId: "test-wig", sku: "TW-16", description: "Item TW-16", unitPriceCents: 10_000, quantity: 1 },
      { productId: "test-lashes", sku: "TL", description: "Item TL", unitPriceCents: 1_500, quantity: 2 },
    ]);
  });

  it("refuses line items that were not created by our checkout", () => {
    expect(() => toCheckoutCompleted(session(), [lineItem({}, "X", 100, 1)], new Date())).toThrow(/metadata/);
  });
});

describe("reading a Stripe webhook", () => {
  const provider = stripePaymentProvider(
    async () => stripe,
    async () => WEBHOOK_SECRET,
    { stage: "dev", webhookSecretParameter: "unused-in-tests" },
  );

  /** A webhook body and a genuine signature for it, as Stripe would send. */
  async function signedNotification(type: string, object: Stripe.Checkout.Session, secret = WEBHOOK_SECRET) {
    const payload = JSON.stringify({ id: "evt_1", object: "event", type, created: 1_794_657_600, data: { object } });
    const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
    return { payload, signature };
  }

  /** What Stripe returns when the session is read back. */
  function stripeHolds(current: Stripe.Checkout.Session, lineItems: Stripe.LineItem[] = [wigLine]) {
    vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(current as never);
    vi.spyOn(stripe.checkout.sessions, "listLineItems").mockReturnValue({
      autoPagingToArray: async () => lineItems,
    } as never);
  }

  beforeEach(() => vi.restoreAllMocks());

  it("rejects a notification signed with the wrong secret", async () => {
    const forged = await signedNotification("checkout.session.completed", session(), "whsec_attacker");
    await expect(provider.readNotification(forged)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("rejects a notification whose body was altered after signing", async () => {
    const genuine = await signedNotification("checkout.session.completed", session());
    const tampered = { ...genuine, payload: genuine.payload.replace("cs_test_abc123", "cs_test_other") };
    await expect(provider.readNotification(tampered)).rejects.toMatchObject({ kind: "invalid" });
  });

  it.each(["checkout.session.completed", "checkout.session.async_payment_succeeded"])(
    "reports a completed checkout for a paid %s",
    async (eventType) => {
      stripeHolds(session());

      const event = await provider.readNotification(await signedNotification(eventType, session()));

      expect(event).toMatchObject({
        type: "checkout_completed",
        checkout: { checkoutSessionId: "cs_test_abc123", totalCents: 13_795, paidAt: "2026-11-14T12:00:00.000Z" },
      });
    },
  );

  it("waits when checkout completed but a pay-later payment is still pending", async () => {
    stripeHolds(session({ payment_status: "unpaid" }));

    const notification = await signedNotification("checkout.session.completed", session({ payment_status: "unpaid" }));

    expect(await provider.readNotification(notification)).toBeNull();
  });

  it("decides on the session's current state, not the copy inside the notification", async () => {
    stripeHolds(session({ payment_status: "paid" }));

    const stale = await signedNotification("checkout.session.completed", session({ payment_status: "unpaid" }));

    expect(await provider.readNotification(stale)).toMatchObject({ type: "checkout_completed" });
  });

  it("reports a declined pay-later payment", async () => {
    const notification = await signedNotification("checkout.session.async_payment_failed", session({ payment_status: "unpaid" }));

    expect(await provider.readNotification(notification)).toEqual({
      type: "checkout_payment_failed",
      failure: { checkoutSessionId: "cs_test_abc123", basketId: BASKET_ID, email: "buyer@example.com", customerName: "Bea Buyer" },
    });
  });

  it("ignores sessions that belong to another stage", async () => {
    const fromProd = session({ metadata: { basketId: BASKET_ID, stage: "prod" } });
    expect(await provider.readNotification(await signedNotification("checkout.session.completed", fromProd))).toBeNull();
  });

  it("ignores event types it does not act on", async () => {
    expect(await provider.readNotification(await signedNotification("charge.refunded", session()))).toBeNull();
  });
});
