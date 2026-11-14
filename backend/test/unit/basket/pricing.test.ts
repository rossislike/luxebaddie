import { describe, expect, it } from "vitest";
import { itemsOf, priceBasket } from "../../../src/basket/domain/pricing";
import { FREE_SHIPPING_THRESHOLD_CENTS, STANDARD_SHIPPING_CENTS } from "../../../src/basket/domain/shipping";
import { BASKET_ID, catalog, lashes, wig } from "../fixtures";

describe("priceBasket", () => {
  it("prices lines from the catalog and totals them", () => {
    const basket = priceBasket(
      BASKET_ID,
      [
        { productId: "test-wig", sku: "TW-16", quantity: 1 },
        { productId: "test-lashes", sku: "TL", quantity: 2 },
      ],
      catalog(wig, lashes),
    );

    expect(basket.lines).toEqual([
      expect.objectContaining({ sku: "TW-16", productName: "Test Wig", variantTitle: '16"', unitPriceCents: 10_000, lineTotalCents: 10_000 }),
      expect.objectContaining({ sku: "TL", variantTitle: "", unitPriceCents: 1_500, lineTotalCents: 3_000, image: null }),
    ]);
    expect(basket.subtotalCents).toBe(13_000);
    expect(basket.removed).toEqual([]);
  });

  it("merges repeated lines for the same variant", () => {
    const basket = priceBasket(
      BASKET_ID,
      [
        { productId: "test-lashes", sku: "TL", quantity: 1 },
        { productId: "test-lashes", sku: "TL", quantity: 3 },
      ],
      catalog(lashes),
    );
    expect(itemsOf(basket)).toEqual([{ productId: "test-lashes", sku: "TL", quantity: 4 }]);
  });

  it("removes items that are unknown, inactive, or from a draft product", () => {
    const draftLashes = { ...lashes, status: "draft" as const };
    const notForSale = [
      { productId: "test-wig", sku: "TW-24", quantity: 1 }, // inactive variant
      { productId: "test-wig", sku: "NOPE", quantity: 1 }, // unknown sku
      { productId: "ghost", sku: "X", quantity: 1 }, // unknown product
      { productId: "test-lashes", sku: "TL", quantity: 1 }, // draft product
    ];
    const basket = priceBasket(BASKET_ID, notForSale, catalog(wig, draftLashes));

    expect(basket.lines).toEqual([]);
    expect(basket.removed).toEqual(notForSale);
  });
});

describe("shipping", () => {
  it("charges the flat rate below the free-shipping threshold", () => {
    const basket = priceBasket(BASKET_ID, [{ productId: "test-wig", sku: "TW-16", quantity: 1 }], catalog(wig));
    expect(basket.subtotalCents).toBeLessThan(FREE_SHIPPING_THRESHOLD_CENTS);
    expect(basket.shippingCents).toBe(STANDARD_SHIPPING_CENTS);
  });

  it("is free once the subtotal reaches the threshold", () => {
    const basket = priceBasket(BASKET_ID, [{ productId: "test-wig", sku: "TW-20", quantity: 2 }], catalog(wig));
    expect(basket.subtotalCents).toBeGreaterThanOrEqual(FREE_SHIPPING_THRESHOLD_CENTS);
    expect(basket.shippingCents).toBe(0);
  });

  it("is zero for an empty basket", () => {
    expect(priceBasket(BASKET_ID, [], catalog()).shippingCents).toBe(0);
  });
});
