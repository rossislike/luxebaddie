/**
 * PLACEHOLDER CATALOG. These products, prices and descriptions are stand-ins so
 * the store can be built and tested end to end. Replace them with the real
 * vendor line (and real photography) before launch - see ROADMAP.md. Copy here
 * deliberately avoids material claims (hair origin, grade) that only the
 * chosen vendor can back up.
 */
import type { Product, Variant } from "@luxebaddy/contracts";

const dollars = (amount: number) => Math.round(amount * 100);

/** One variant per length. `prices` maps length in inches to a dollar price. */
function byLength(skuPrefix: string, prices: Record<number, number>): Variant[] {
  return Object.entries(prices).map(([inches, price]) => ({
    sku: `${skuPrefix}-${inches}`,
    options: { Length: `${inches}"` },
    priceCents: dollars(price),
    active: true,
  }));
}

/** One variant per length and density. Higher density adds a fixed upcharge. */
function byLengthAndDensity(skuPrefix: string, prices: Record<number, number>, upcharge: number): Variant[] {
  return Object.entries(prices).flatMap(([inches, price]) => [
    {
      sku: `${skuPrefix}-${inches}-150`,
      options: { Length: `${inches}"`, Density: "150%" },
      priceCents: dollars(price),
      active: true,
    },
    {
      sku: `${skuPrefix}-${inches}-180`,
      options: { Length: `${inches}"`, Density: "180%" },
      priceCents: dollars(price + upcharge),
      active: true,
    },
  ]);
}

const base = { images: [] as string[], status: "active" as const, featured: false };

export const seedProducts: Product[] = [
  // ---------------------------------------------------------------- Wigs
  {
    ...base,
    id: "body-wave-lace-front-wig",
    name: "Body Wave Lace Front Wig",
    category: "wigs",
    tagline: "Soft, bouncy waves with a melted hairline.",
    description:
      "Our signature body wave. Loose S-shaped waves that move when you do, on a lace front that disappears into your hairline. Pre-plucked and ready to style straight out of the box.",
    highlights: ["13x4 lace front", "Pre-plucked hairline", "Adjustable band and combs", "Can be heat styled"],
    optionNames: ["Length", "Density"],
    featured: true,
    position: 10,
    variants: byLengthAndDensity("WIG-BW", { 16: 189, 20: 229, 24: 279, 28: 339 }, 40),
  },
  {
    ...base,
    id: "silky-straight-hd-lace-wig",
    name: "Silky Straight HD Lace Wig",
    category: "wigs",
    tagline: "Glass-smooth length. Zero effort.",
    description:
      "Bone-straight and impossibly sleek, finished with ultra-thin HD lace for a scalp-like part. The one you reach for when the look needs to be flawless.",
    highlights: ["HD lace front", "Natural-looking part", "Adjustable band and combs", "Can be heat styled"],
    optionNames: ["Length", "Density"],
    featured: true,
    position: 20,
    variants: byLengthAndDensity("WIG-ST", { 18: 219, 22: 269, 26: 329, 30: 399 }, 45),
  },
  {
    ...base,
    id: "deep-wave-glueless-wig",
    name: "Deep Wave Glueless Wig",
    category: "wigs",
    tagline: "Big, defined curls. On in minutes.",
    description:
      "Deep, springy waves with serious volume. The glueless cap means no adhesive and no install appointment: adjust the band, secure, and go.",
    highlights: ["Glueless, beginner-friendly cap", "Pre-cut lace", "Adjustable band", "Wear-and-go"],
    optionNames: ["Length"],
    position: 30,
    variants: byLength("WIG-DW", { 18: 239, 22: 289, 26: 349 }),
  },
  {
    ...base,
    id: "blunt-cut-bob-wig",
    name: "Blunt Cut Bob Wig",
    category: "wigs",
    tagline: "Sharp lines. Main-character energy.",
    description:
      "A precision blunt bob that frames the face and means business. Lightweight, easy to maintain, and effortless to wear every day.",
    highlights: ["Lace front", "Blunt cut ends", "Lightweight for daily wear", "Adjustable band and combs"],
    optionNames: ["Length"],
    featured: true,
    position: 40,
    variants: byLength("WIG-BOB", { 10: 129, 12: 149, 14: 169 }),
  },

  // -------------------------------------------------------------- Weaves
  {
    ...base,
    id: "body-wave-bundle",
    name: "Body Wave Bundle",
    category: "weaves",
    tagline: "Full, flowing waves. Sold by the bundle.",
    description:
      "Soft body wave wefts with a full, even thickness from top to tip. Most installs use three bundles; go for four when you want extra volume at longer lengths.",
    highlights: ["Sold as a single bundle", "Double-stitched weft", "Full from top to tip", "Can be heat styled"],
    optionNames: ["Length"],
    featured: true,
    position: 50,
    variants: byLength("WVE-BW", { 14: 59, 18: 79, 22: 99, 26: 125 }),
  },
  {
    ...base,
    id: "silky-straight-bundle",
    name: "Silky Straight Bundle",
    category: "weaves",
    tagline: "Sleek, swingy length. Sold by the bundle.",
    description:
      "Smooth, straight wefts with natural shine and movement. Pair with a closure or frontal for a seamless sew-in.",
    highlights: ["Sold as a single bundle", "Double-stitched weft", "Full from top to tip", "Can be heat styled"],
    optionNames: ["Length"],
    position: 60,
    variants: byLength("WVE-ST", { 14: 59, 18: 79, 22: 99, 26: 125 }),
  },
  {
    ...base,
    id: "hd-lace-closure-4x4",
    name: "HD Lace Closure 4x4",
    category: "weaves",
    tagline: "The finishing piece for a flawless sew-in.",
    description:
      "A 4x4 HD lace closure that blends into the scalp for a natural part. Free part design so you can go middle, side, or anywhere in between.",
    highlights: ["4x4 HD lace", "Free part", "Pre-plucked", "Pairs with any bundle"],
    optionNames: ["Length"],
    position: 70,
    variants: byLength("WVE-CL44", { 14: 79, 16: 89, 18: 99 }),
  },
  {
    ...base,
    id: "hd-lace-frontal-13x4",
    name: "HD Lace Frontal 13x4",
    category: "weaves",
    tagline: "Ear-to-ear lace for total styling freedom.",
    description:
      "A 13x4 HD lace frontal that recreates your whole hairline. Pull it back, part it anywhere, and style without limits.",
    highlights: ["13x4 HD lace, ear to ear", "Pre-plucked hairline", "Style in any direction", "Pairs with any bundle"],
    optionNames: ["Length"],
    position: 80,
    variants: byLength("WVE-FR134", { 14: 119, 16: 135, 18: 149 }),
  },

  // -------------------------------------------------------------- Lashes
  {
    ...base,
    id: "soft-glam-lashes",
    name: "Soft Glam Lashes",
    category: "lashes",
    tagline: "Fluffy, flirty, and never too much.",
    description:
      "A wispy, medium-volume strip lash that lifts the eye without overpowering it. Lightweight on a flexible band, comfortable from brunch to last call.",
    highlights: ["Medium volume", "Flexible cotton band", "Reusable with proper care", "Adhesive not included"],
    optionNames: ["Pack"],
    featured: true,
    position: 90,
    variants: [
      { sku: "LSH-SG-1", options: { Pack: "1 pair" }, priceCents: dollars(14), active: true },
      { sku: "LSH-SG-3", options: { Pack: "3 pairs" }, priceCents: dollars(36), compareAtCents: dollars(42), active: true },
    ],
  },
  {
    ...base,
    id: "full-drama-lashes",
    name: "Full Drama Lashes",
    category: "lashes",
    tagline: "Maximum volume. No apologies.",
    description:
      "Dense, dramatic, and built for the camera. A full-volume strip lash with a winged flare that opens the eye and steals the scene.",
    highlights: ["Full volume", "Winged, cat-eye shape", "Reusable with proper care", "Adhesive not included"],
    optionNames: ["Pack"],
    position: 100,
    variants: [
      { sku: "LSH-FD-1", options: { Pack: "1 pair" }, priceCents: dollars(16), active: true },
      { sku: "LSH-FD-3", options: { Pack: "3 pairs" }, priceCents: dollars(40), compareAtCents: dollars(48), active: true },
    ],
  },
  {
    ...base,
    id: "everyday-wispy-lashes",
    name: "Everyday Wispy Lashes",
    category: "lashes",
    tagline: "Your lashes, but on a really good day.",
    description:
      "A natural, barely-there strip lash for effortless definition. Short, tapered clusters on an invisible band that blend right into your own lashes.",
    highlights: ["Natural volume", "Invisible band", "Reusable with proper care", "Adhesive not included"],
    optionNames: [],
    position: 110,
    variants: [{ sku: "LSH-EW", options: {}, priceCents: dollars(12), active: true }],
  },
];
