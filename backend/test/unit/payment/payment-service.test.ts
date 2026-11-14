import { describe, expect, it } from "vitest";
import type { PaymentEvent, PaymentProvider } from "../../../src/payment/application/ports";
import { createPaymentService } from "../../../src/payment/application/payment-service";
import { invalid } from "../../../src/shared/errors";
import { recordingEvents } from "../fakes";
import { paidCheckout } from "../fixtures";

const notification = { payload: "{}", signature: "sig" };
const providerThat = (readNotification: PaymentProvider["readNotification"]): PaymentProvider => ({ readNotification });

const completed: PaymentEvent = { type: "checkout_completed", checkout: paidCheckout };
const failed: PaymentEvent = {
  type: "checkout_payment_failed",
  failure: { checkoutSessionId: "cs_test_abc123", basketId: null, email: "buyer@example.com", customerName: "Bea Buyer" },
};

describe("handling a payment notification", () => {
  it.each([
    ["a paid checkout", completed],
    ["a pay-later payment that was declined", failed],
  ])("publishes the business event for %s", async (_what, event) => {
    const events = recordingEvents();
    const service = createPaymentService({ provider: providerThat(async () => event), events });

    await service.handleNotification(notification);

    expect(events.published).toEqual([event]);
  });

  it("publishes nothing for notifications we do not act on", async () => {
    const events = recordingEvents();
    const service = createPaymentService({ provider: providerThat(async () => null), events });

    await service.handleNotification(notification);

    expect(events.published).toEqual([]);
  });

  it("rejects forged notifications without publishing", async () => {
    const events = recordingEvents();
    const forged = providerThat(async () => {
      throw invalid("Invalid Stripe signature");
    });
    const service = createPaymentService({ provider: forged, events });

    await expect(service.handleNotification(notification)).rejects.toMatchObject({ kind: "invalid" });
    expect(events.published).toEqual([]);
  });

  it("fails when the event cannot be published, so the provider redelivers", async () => {
    const service = createPaymentService({
      provider: providerThat(async () => completed),
      events: {
        publish: async () => {
          throw new Error("event bus unavailable");
        },
      },
    });

    await expect(service.handleNotification(notification)).rejects.toThrow("event bus unavailable");
  });
});
