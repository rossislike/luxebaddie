import type { CheckoutCompleted, CheckoutPaymentFailed } from "@luxebaddie/contracts";

/** A message from the payment provider, exactly as it arrived. */
export type PaymentNotification = {
  payload: string;
  signature: string;
};

/** What a payment notification means to the business. */
export type PaymentEvent =
  | { type: "checkout_completed"; checkout: CheckoutCompleted }
  | { type: "checkout_payment_failed"; failure: CheckoutPaymentFailed };

/** The payment provider (Stripe), seen from our side. */
export interface PaymentProvider {
  /**
   * Authenticates a notification and translates it into our own terms.
   * Returns null when the notification is about something we do not act on.
   * Rejects forged notifications.
   */
  readNotification(notification: PaymentNotification): Promise<PaymentEvent | null>;
}

/** Announces business events to the rest of the system. */
export interface EventPublisher {
  publish(event: PaymentEvent): Promise<void>;
}
