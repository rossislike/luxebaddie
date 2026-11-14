import { describe, expect, it } from "vitest";
import { buildCheckoutSessionParams } from "../../../src/basket/adapters/stripe-checkout-gateway";
import { priceBasket } from "../../../src/basket/domain/pricing";
import { STANDARD_SHIPPING_CENTS } from "../../../src/basket/domain/shipping";
import { BASKET_ID, catalog, lashes, wig } from "../fixtures";

const config = { stage: "dev", storefrontUrl: "https://shop.example.com", automaticTax: false };

describe("buildCheckoutSessionParams", () => {
  const basket = priceBasket(
    BASKET_ID,
    [
      { productId: "test-wig", sku: "TW-16", quantity: 1 },
      { productId: "test-lashes", sku: "TL", quantity: 2 },
    ],
    catalog(wig, lashes),
  );
  const params = buildCheckoutSessionParams(basket, config);

  it("charges catalog prices and tags each line with its product and SKU", () => {
    expect(params.line_items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 10_000,
          tax_behavior: "exclusive",
          product_data: {
            name: 'Test Wig - 16"',
            images: ["https://cdn.example.com/test-wig.jpg"],
            metadata: { productId: "test-wig", sku: "TW-16" },
          },
        },
      },
      {
        quantity: 2,
        price_data: {
          currency: "usd",
          unit_amount: 1_500,
          tax_behavior: "exclusive",
          product_data: { name: "Test Lashes", images: undefined, metadata: { productId: "test-lashes", sku: "TL" } },
        },
      },
    ]);
  });

  it("identifies the basket and stage so the payment can be matched back", () => {
    expect(params.metadata).toEqual({ basketId: BASKET_ID, stage: "dev" });
  });

  it("leaves the choice of payment methods to Stripe", () => {
    expect(params).not.toHaveProperty("payment_method_types");
  });

  it("labels the session so this checkout flow can be tracked in Stripe", () => {
    expect(params.integration_identifier).toMatch(/^luxebaddie_bag_checkout_[a-z]{8}$/);
  });

  it("collects no tax unless the stage has Stripe Tax switched on", () => {
    expect(params.automatic_tax).toEqual({ enabled: false });
    expect(buildCheckoutSessionParams(basket, { ...config, automaticTax: true }).automatic_tax).toEqual({ enabled: true });
  });

  it("returns the shopper to the storefront", () => {
    expect(params.success_url).toBe("https://shop.example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toBe("https://shop.example.com/bag");
  });

  it("charges the basket's shipping amount", () => {
    expect(params.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount).toBe(STANDARD_SHIPPING_CENTS);

    const freeShippingBasket = priceBasket(BASKET_ID, [{ productId: "test-wig", sku: "TW-20", quantity: 2 }], catalog(wig));
    const free = buildCheckoutSessionParams(freeShippingBasket, config);
    expect(free.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount).toBe(0);
  });
});
