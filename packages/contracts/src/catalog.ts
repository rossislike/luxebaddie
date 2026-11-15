import { z } from "zod";

/** All money is integer cents in USD. */
export const centsSchema = z.number().int().positive().max(10_000_000);

/** Positions are zero-padded into a sort key, so they need a fixed upper bound. */
export const MAX_POSITION = 999_999;

export const CATEGORY_SLUGS = ["wigs", "weaves", "lashes"] as const;
export const categorySlugSchema = z.enum(CATEGORY_SLUGS);
export type CategorySlug = z.infer<typeof categorySlugSchema>;

export const variantSchema = z.object({
  sku: z
    .string()
    .max(64)
    .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, "SKU must be uppercase letters, digits and hyphens"),
  /** Option values keyed by the product's optionNames, e.g. { Length: '18"' }. */
  options: z.record(z.string(), z.string()),
  priceCents: centsSchema,
  /** Optional "was" price, shown struck through when higher than priceCents. */
  compareAtCents: centsSchema.optional(),
  active: z.boolean(),
});
export type Variant = z.infer<typeof variantSchema>;

export const productSchema = z
  .object({
    /** URL-safe id, also used as the product page slug. */
    id: z
      .string()
      .max(80)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be lowercase letters, digits and hyphens"),
    name: z.string().min(1).max(120),
    category: categorySlugSchema,
    tagline: z.string().max(200),
    description: z.string().max(4000),
    /** Short bullet points shown on the product page. */
    highlights: z.array(z.string().max(200)).max(12),
    /** Ordered option names, e.g. ["Length", "Density"]. Empty for single-variant products. */
    optionNames: z.array(z.string().min(1).max(40)).max(3),
    /** Absolute image URLs. Empty until product photography exists. */
    images: z.array(z.url()).max(12),
    status: z.enum(["draft", "active"]),
    featured: z.boolean(),
    /** Sort order within a category, ascending. */
    position: z.number().int().min(0).max(MAX_POSITION),
    variants: z.array(variantSchema).min(1).max(100),
  })
  .superRefine((product, ctx) => {
    const skus = new Set<string>();
    product.variants.forEach((variant, index) => {
      if (skus.has(variant.sku)) {
        ctx.addIssue({ code: "custom", path: ["variants", index, "sku"], message: `Duplicate SKU ${variant.sku}` });
      }
      skus.add(variant.sku);

      const keys = Object.keys(variant.options);
      const matches =
        keys.length === product.optionNames.length && product.optionNames.every((name) => name in variant.options);
      if (!matches) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "options"],
          message: `Options must have exactly these keys: ${product.optionNames.join(", ") || "(none)"}`,
        });
      }
    });
  });
export type Product = z.infer<typeof productSchema>;

/** The kinds of image file a product photo may be. No SVG: an SVG can carry scripts. */
export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

/** The largest photo file accepted. The back office shrinks photos well below this before sending them. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const photoUploadRequestSchema = z.object({ contentType: z.enum(PHOTO_CONTENT_TYPES) });

/**
 * Permission to upload one photo, straight from the browser to storage. It is
 * good for a few minutes, for one file of the agreed kind, up to MAX_PHOTO_BYTES.
 */
export type PhotoUpload = {
  /** Where to send the file, as a multipart form post. */
  uploadUrl: string;
  /** Form fields to send along, before the file itself. */
  fields: Record<string, string>;
  /** The photo's public address once it is uploaded: what goes into a product's `images`. */
  photoUrl: string;
};

/** "18\" / 150%" style label for a variant. Empty for single-variant products. */
export function variantTitle(product: Pick<Product, "optionNames">, variant: Pick<Variant, "options">): string {
  return product.optionNames.map((name) => variant.options[name]).join(" / ");
}

/** The lowest active variant price, used for "From $X" in listings. */
export function startingPriceCents(product: Pick<Product, "variants">): number | null {
  const prices = product.variants.filter((v) => v.active).map((v) => v.priceCents);
  return prices.length > 0 ? Math.min(...prices) : null;
}
