import { describe, expect, it } from "vitest";
import { defaultSelection, findVariant, isSelectable, optionValues, select } from "@/catalog/variant-selection";

const variant = (sku: string, length: string, density: string, active = true) => ({
  sku,
  options: { Length: length, Density: density },
  priceCents: 10_000,
  active,
});

// 16" comes in both densities, 20" only in 150%, and 24" is not currently sold.
const wig = {
  optionNames: ["Length", "Density"],
  variants: [
    variant("W-16-150", '16"', "150%"),
    variant("W-16-180", '16"', "180%"),
    variant("W-20-150", '20"', "150%"),
    variant("W-24-150", '24"', "150%", false),
  ],
};

describe("variant selection", () => {
  it("offers only option values that are for sale", () => {
    expect(optionValues(wig)).toEqual({ Length: ['16"', '20"'], Density: ["150%", "180%"] });
  });

  it("starts on the first variant for sale", () => {
    expect(defaultSelection(wig)).toEqual({ Length: '16"', Density: "150%" });
  });

  it("finds the variant for a complete selection", () => {
    expect(findVariant(wig, { Length: '16"', Density: "180%" })?.sku).toBe("W-16-180");
    expect(findVariant(wig, { Length: '20"', Density: "180%" })).toBeNull();
  });

  it("flags combinations that are not sold", () => {
    const selection = { Length: '20"', Density: "150%" };
    expect(isSelectable(wig, selection, "Density", "150%")).toBe(true);
    expect(isSelectable(wig, selection, "Density", "180%")).toBe(false);
  });

  it("keeps the other choices when the new combination exists", () => {
    expect(select(wig, { Length: '16"', Density: "180%" }, "Length", '16"')).toEqual({ Length: '16"', Density: "180%" });
  });

  it("falls back to a sold combination rather than landing on nothing", () => {
    expect(select(wig, { Length: '16"', Density: "180%" }, "Length", '20"')).toEqual({ Length: '20"', Density: "150%" });
  });

  it("treats a product without options as a single variant", () => {
    const lashes = { optionNames: [], variants: [{ sku: "L", options: {}, priceCents: 1_200, active: true }] };
    expect(findVariant(lashes, defaultSelection(lashes))?.sku).toBe("L");
  });
});
