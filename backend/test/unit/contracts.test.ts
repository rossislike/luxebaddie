import { productSchema, startingPriceCents, variantTitle } from "@luxebaddy/contracts";
import { describe, expect, it } from "vitest";
import { seedProducts } from "../../scripts/seed-data";
import { lashes, wig } from "./fixtures";

describe("productSchema", () => {
  it("accepts every product in the seed catalog", () => {
    for (const product of seedProducts) {
      expect(productSchema.safeParse(product).error?.issues, product.id).toBeUndefined();
    }
    const ids = seedProducts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects duplicate SKUs within a product", () => {
    const result = productSchema.safeParse({ ...wig, variants: [wig.variants[0], wig.variants[0]] });
    expect(result.success).toBe(false);
  });

  it("rejects a variant whose options do not match the product's option names", () => {
    const result = productSchema.safeParse({
      ...wig,
      variants: [{ sku: "TW-X", options: { Colour: "Black" }, priceCents: 100, active: true }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects ids that are not URL-safe slugs", () => {
    expect(productSchema.safeParse({ ...wig, id: "Test Wig!" }).success).toBe(false);
  });
});

describe("catalog helpers", () => {
  it("labels a variant by its option values, in option order", () => {
    const product = { optionNames: ["Length", "Density"] };
    expect(variantTitle(product, { options: { Density: "180%", Length: '20"' } })).toBe('20" / 180%');
    expect(variantTitle(lashes, lashes.variants[0]!)).toBe("");
  });

  it("finds the lowest price among active variants only", () => {
    expect(startingPriceCents(wig)).toBe(10_000);
    expect(startingPriceCents({ variants: wig.variants.map((v) => ({ ...v, active: false })) })).toBeNull();
  });
});
