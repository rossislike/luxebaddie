import type { Product } from "@luxebaddie/contracts";
import { describe, expect, it } from "vitest";
import {
  addressFrom,
  centsOf,
  draftOf,
  emptyDraft,
  productOf,
  withOptionAdded,
  withOptionRemoved,
  withOptionRenamed,
} from "@/catalog/product-draft";

const wig: Product = {
  id: "body-wave-wig",
  name: "Body Wave Wig",
  category: "wigs",
  tagline: "Soft waves.",
  description: "A wig.",
  highlights: ["13x4 lace front", "Pre-plucked"],
  optionNames: ["Length"],
  images: ["https://cdn.example.com/wig.jpg"],
  status: "active",
  featured: true,
  position: 20,
  variants: [
    { sku: "WIG-BW-16", options: { Length: '16"' }, priceCents: 18_900, compareAtCents: 22_900, active: true },
    { sku: "WIG-BW-20", options: { Length: '20"' }, priceCents: 22_995, active: false },
  ],
};

describe("a product in the form", () => {
  it("comes back out exactly as it went in when nothing is changed", () => {
    expect(productOf(draftOf(wig))).toEqual({ product: wig, problems: [] });
  });

  it("shows prices in dollars, without cents when there are none", () => {
    expect(draftOf(wig).variants.map((variant) => [variant.price, variant.compareAt])).toEqual([
      ["189", "229"],
      ["229.95", ""],
    ]);
  });

  it("tidies what was typed: spaces trimmed, SKUs capitalised, empty highlight lines dropped", () => {
    const draft = draftOf(wig);
    const typed = {
      ...draft,
      name: "  Body Wave Wig ",
      highlights: "13x4 lace front\n\n  Pre-plucked  \n",
      variants: draft.variants.map((variant) => ({ ...variant, sku: ` ${variant.sku.toLowerCase()} ` })),
    };

    expect(productOf(typed).product).toEqual(wig);
  });
});

describe("a new product", () => {
  it("starts as a draft, so nothing half-finished reaches the shop", () => {
    expect(emptyDraft()).toMatchObject({ status: "draft", featured: false });
  });

  it("is not accepted until it has a name, an address, a SKU and a price", () => {
    const { product, problems } = productOf(emptyDraft());

    expect(product).toBeNull();
    expect(problems).toEqual(
      expect.arrayContaining([
        "Give the product a name (up to 120 characters).",
        "The shop address uses lowercase letters, numbers and hyphens, like body-wave-wig.",
        "Row 1: a SKU uses capital letters, numbers and hyphens, like WIG-BW-18.",
        "Row 1: enter a price above zero, like 189 or 189.95.",
      ]),
    );
  });
});

describe("what is wrong with a draft, in the owner's words", () => {
  const withRows = (change: (draft: ReturnType<typeof draftOf>) => ReturnType<typeof draftOf>) => productOf(change(draftOf(wig))).problems;

  it("points at the row with a price that is not a price", () => {
    expect(withRows((d) => ({ ...d, variants: d.variants.map((v, i) => (i === 1 ? { ...v, price: "about 200" } : v)) }))).toEqual([
      "Row 2: enter a price above zero, like 189 or 189.95.",
    ]);
  });

  it("points at a SKU used twice", () => {
    expect(withRows((d) => ({ ...d, variants: d.variants.map((v) => ({ ...v, sku: "WIG-BW-16" })) }))).toEqual([
      "Row 2: this SKU is used by another row.",
    ]);
  });

  it("asks for a missing option value by the option's name", () => {
    expect(withRows((d) => ({ ...d, variants: d.variants.map((v, i) => (i === 0 ? { ...v, options: { Length: " " } } : v)) }))).toEqual([
      "Row 1: fill in Length.",
    ]);
  });

  it("does not allow two rows to offer the same choice", () => {
    expect(withRows((d) => ({ ...d, variants: d.variants.map((v) => ({ ...v, options: { Length: '16"' } })) }))).toEqual([
      "Two rows offer exactly the same choice. Each row must be a different combination.",
    ]);
  });

  it("does not accept a position that is not a whole number", () => {
    expect(withRows((d) => ({ ...d, position: "first" }))).toEqual(["Position is a whole number from 0 to 999999."]);
  });
});

describe("centsOf", () => {
  it.each([
    ["189", 18_900],
    ["189.5", 18_950],
    ["189.95", 18_995],
    [" $1,299.00 ", 129_900],
    ["0.07", 7],
  ])("reads %j as %i cents", (typed, cents) => {
    expect(centsOf(typed)).toBe(cents);
  });

  it.each(["", "free", "189.999", "-5", "1e3", "12 dollars"])("does not read %j as a price", (typed) => {
    expect(centsOf(typed)).toBeNaN();
  });
});

describe("addressFrom", () => {
  it.each([
    ["Body Wave Lace Front Wig", "body-wave-lace-front-wig"],
    ['  18" Silky Straight (HD Lace)!  ', "18-silky-straight-hd-lace"],
    ["Café Crème Lashes", "cafe-creme-lashes"],
  ])("suggests an address for %j", (name, address) => {
    expect(addressFrom(name)).toBe(address);
  });

  it("never suggests more than the 80 characters an address may have, or ends on a hyphen", () => {
    const address = addressFrom(`${"a".repeat(79)} wig`);

    expect(address.length).toBeLessThanOrEqual(80);
    expect(address.endsWith("-")).toBe(false);
  });
});

describe("changing a product's options", () => {
  const draft = draftOf(wig);

  it("adds an option to every row, empty, under a name that is not taken", () => {
    const added = withOptionAdded(draft);

    expect(added.optionNames).toEqual(["Length", "Option 2"]);
    expect(added.variants.map((variant) => variant.options)).toEqual([
      { Length: '16"', "Option 2": "" },
      { Length: '20"', "Option 2": "" },
    ]);
  });

  it("renames an option and keeps each row's value for it", () => {
    const renamed = withOptionRenamed(draft, 0, "Inches");

    expect(renamed.optionNames).toEqual(["Inches"]);
    expect(renamed.variants.map((variant) => variant.options)).toEqual([{ Inches: '16"' }, { Inches: '20"' }]);
  });

  it("will not rename an option to a name another option has", () => {
    const two = withOptionAdded(draft);

    expect(withOptionRenamed(two, 1, "Length")).toBe(two);
  });

  it("removes an option from every row", () => {
    const removed = withOptionRemoved(withOptionAdded(draft), 0);

    expect(removed.optionNames).toEqual(["Option 2"]);
    expect(removed.variants.map((variant) => variant.options)).toEqual([{ "Option 2": "" }, { "Option 2": "" }]);
  });
});
