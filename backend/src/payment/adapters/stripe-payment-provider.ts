import type { CheckoutCompleted, CheckoutPaymentFailed, OrderItem } from "@luxebaddy/contracts";
import type Stripe from "stripe";
import type { SecretReader } from "../../shared/adapters/ssm-secrets";
import type { StripeProvider } from "../../shared/adapters/stripe-client";
import { invalid } from "../../shared/errors";
import type { PaymentEvent, PaymentProvider } from "../application/ports";

/** Far above the basket's line limit; a guard against paging forever. */
const MAX_LINE_ITEMS = 1000;

export type StripePaymentConfig = {
  stage: string;
  webhookSecretParameter: string;
};

/**
 * Anti-corruption layer for Stripe: verifies webhook signatures and translates
 * Stripe's data shapes into our CheckoutCompleted event, so nothing beyond
 * this file depends on how Stripe models a payment.
 */
export function stripePaymentProvider(
  getStripe: StripeProvider,
  readSecret: SecretReader,
  config: StripePaymentConfig,
): PaymentProvider {
  async function verify(stripe: Stripe, payload: string, signature: string): Promise<Stripe.Event> {
    const webhookSecret = await readSecret(config.webhookSecretParameter);
    try {
      return await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
    } catch {
      throw invalid("Invalid Stripe signature");
    }
  }

  /**
   * The event only says that something happened to a session. The session is
   * read back from Stripe so the decision is made on its current state, as
   * Stripe's fulfillment guide recommends.
   */
  async function readPaidCheckout(stripe: Stripe, sessionId: string, paidAt: Date): Promise<PaymentEvent | null> {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    // "unpaid" means a pay-later method is still pending; async_payment_succeeded follows.
    if (session.payment_status === "unpaid") return null;

    const lineItems = await stripe.checkout.sessions
      .listLineItems(sessionId, { limit: 100, expand: ["data.price.product"] })
      .autoPagingToArray({ limit: MAX_LINE_ITEMS });
    return { type: "checkout_completed", checkout: toCheckoutCompleted(session, lineItems, paidAt) };
  }

  return {
    async readNotification({ payload, signature }) {
      const stripe = await getStripe();
      const event = await verify(stripe, payload, signature);

      switch (event.type) {
        case "checkout.session.completed":
        // Pay-later methods confirm after checkout, with this second event.
        case "checkout.session.async_payment_succeeded":
          if (!isFromThisStage(event.data.object, config.stage)) return null;
          return readPaidCheckout(stripe, event.data.object.id, new Date(event.created * 1000));

        case "checkout.session.async_payment_failed":
          if (!isFromThisStage(event.data.object, config.stage)) return null;
          return { type: "checkout_payment_failed", failure: toCheckoutPaymentFailed(event.data.object) };

        default:
          return null;
      }
    },
  };
}

/** One Stripe account can feed several stages (dev, prod). Each stage handles only its own sessions. */
function isFromThisStage(session: Stripe.Checkout.Session, stage: string): boolean {
  return session.metadata?.stage === stage;
}

function toCheckoutPaymentFailed(session: Stripe.Checkout.Session): CheckoutPaymentFailed {
  return {
    checkoutSessionId: session.id,
    basketId: session.metadata?.basketId ?? null,
    email: session.customer_details?.email ?? null,
    customerName: session.customer_details?.name ?? null,
  };
}

export function toCheckoutCompleted(
  session: Stripe.Checkout.Session,
  lineItems: Stripe.LineItem[],
  paidAt: Date,
): CheckoutCompleted {
  const shipping = session.collected_information?.shipping_details ?? null;
  const address = shipping?.address ?? null;
  const totals = session.total_details;
  const paymentIntent = session.payment_intent;

  return {
    checkoutSessionId: session.id,
    paymentIntentId: typeof paymentIntent === "string" ? paymentIntent : (paymentIntent?.id ?? null),
    basketId: session.metadata?.basketId ?? null,
    email: session.customer_details?.email ?? null,
    customerName: session.customer_details?.name ?? null,
    phone: session.customer_details?.phone ?? null,
    shippingName: shipping?.name ?? null,
    shippingAddress: address && {
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postalCode: address.postal_code,
      country: address.country,
    },
    items: lineItems.map(toOrderItem),
    subtotalCents: session.amount_subtotal ?? 0,
    discountCents: totals?.amount_discount ?? 0,
    shippingCents: totals?.amount_shipping ?? 0,
    taxCents: totals?.amount_tax ?? 0,
    totalCents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    paidAt: paidAt.toISOString(),
  };
}

function toOrderItem(line: Stripe.LineItem): OrderItem {
  const product = line.price?.product;
  const metadata = product && typeof product === "object" && !product.deleted ? product.metadata : null;
  if (!metadata?.productId || !metadata.sku) {
    // Every session we create tags its lines, so this means the session was not ours.
    throw new Error(`Stripe line item ${line.id} is missing productId/sku metadata`);
  }
  return {
    productId: metadata.productId,
    sku: metadata.sku,
    description: line.description ?? metadata.sku,
    unitPriceCents: line.price?.unit_amount ?? 0,
    quantity: line.quantity ?? 1,
  };
}
