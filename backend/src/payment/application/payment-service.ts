import type { EventPublisher, PaymentNotification, PaymentProvider } from "./ports";

interface PaymentPorts {
  provider: PaymentProvider;
  events: EventPublisher;
}

/**
 * Payment use case: what the payment provider tells us becomes a business
 * event (CheckoutCompleted, CheckoutPaymentFailed) that the rest of the system
 * reacts to. Orders are created from these events, never from the shopper
 * reaching the confirmation page, because a shopper can pay and then close
 * the tab.
 *
 * This service owns no data, so there is nothing to keep in step with the
 * event. If publishing fails the error propagates, the provider is told the
 * notification failed, and it delivers it again later. Consumers are
 * idempotent, so a notification that arrives twice is harmless.
 */
export function createPaymentService({ provider, events }: PaymentPorts) {
  return {
    async handleNotification(notification: PaymentNotification): Promise<void> {
      const event = await provider.readNotification(notification);
      if (event) await events.publish(event);
    },
  };
}

export type PaymentService = ReturnType<typeof createPaymentService>;
