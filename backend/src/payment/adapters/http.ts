import { type HttpHandler, header, httpRouter, rawBody } from "../../shared/adapters/api-gateway";
import { invalid } from "../../shared/errors";
import type { PaymentService } from "../application/payment-service";

/**
 *   POST /payment/webhook   called by Stripe, authenticated by its signature
 *
 * Any non-2xx response makes Stripe deliver the notification again later.
 */
export function paymentHttpHandler(payments: PaymentService): HttpHandler {
  return httpRouter({
    "POST /payment/webhook": async (event) => {
      const signature = header(event, "stripe-signature");
      // Reject unsigned calls before doing any work on their behalf.
      if (!signature) throw invalid("Missing Stripe signature");
      // The signature covers the exact bytes Stripe sent, so pass the body through untouched.
      await payments.handleNotification({ payload: rawBody(event), signature });
      return { body: { received: true } };
    },
  });
}
