import type { PricedBasket, PricedLine } from "@luxebaddie/contracts";
import type Stripe from "stripe";
import type { StripeProvider } from "../../shared/adapters/stripe-client";
import type { CheckoutGateway } from "../application/ports";

export type StripeCheckoutConfig = {
  stage: string;
  /** The stage's main storefront, e.g. https://luxebaddie.com. Shoppers return here unless told otherwise. */
  storefrontUrl: string;
  automaticTax: boolean;
};

/**
 * Labels every session this integration creates, so its conversion can be
 * tracked and compared with other checkout flows in the Stripe Dashboard.
 */
const INTEGRATION_IDENTIFIER = "luxebaddie_bag_checkout_qhzvtkwm";

/** US pricing: listed prices exclude sales tax, which is added at checkout when it applies. */
const TAX_BEHAVIOR = "exclusive";

/**
 * Takes payment through Stripe Checkout. Stripe hosts the payment page, so
 * card details never touch our systems.
 */
export function stripeCheckoutGateway(getStripe: StripeProvider, config: StripeCheckoutConfig): CheckoutGateway {
  return {
    async startCheckout(basket, returnTo) {
      const stripe = await getStripe();
      const session = await stripe.checkout.sessions.create(buildCheckoutSessionParams(basket, config, returnTo));
      if (!session.url) throw new Error(`Stripe session ${session.id} has no URL`);
      return session.url;
    },
  };
}

export function buildCheckoutSessionParams(
  basket: PricedBasket,
  config: StripeCheckoutConfig,
  returnTo: string = config.storefrontUrl,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    integration_identifier: INTEGRATION_IDENTIFIER,
    client_reference_id: basket.id,
    metadata: { basketId: basket.id, stage: config.stage },
    line_items: basket.lines.map(toLineItem),
    shipping_address_collection: { allowed_countries: ["US"] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: basket.shippingCents === 0 ? "Free standard shipping" : "Standard shipping",
          fixed_amount: { amount: basket.shippingCents, currency: "usd" },
          tax_behavior: TAX_BEHAVIOR,
        },
      },
    ],
    phone_number_collection: { enabled: true },
    allow_promotion_codes: true,
    // Payment methods are deliberately not listed here: Stripe shows the ones
    // enabled in the Dashboard (cards, wallets, Afterpay, Klarna...) that suit each shopper.
    //
    // Tax is only collected in places with an active Stripe Tax registration.
    // Switching this on without one silently collects nothing (see ROADMAP.md).
    automatic_tax: { enabled: config.automaticTax },
    success_url: `${returnTo}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnTo}/bag`,
  };
}

/**
 * Each line carries its productId and SKU as metadata. The payment service
 * reads them back when Stripe confirms the payment, which makes Stripe the
 * record of exactly what was sold.
 */
function toLineItem(line: PricedLine): Stripe.Checkout.SessionCreateParams.LineItem {
  return {
    quantity: line.quantity,
    price_data: {
      currency: "usd",
      unit_amount: line.unitPriceCents,
      tax_behavior: TAX_BEHAVIOR,
      product_data: {
        name: line.variantTitle ? `${line.productName} - ${line.variantTitle}` : line.productName,
        images: line.image ? [line.image] : undefined,
        metadata: { productId: line.productId, sku: line.sku },
      },
    },
  };
}
