import { type CategorySlug, type Product, productSchema, type Variant } from "@luxebaddie/contracts";

/**
 * A product while it is being typed into the form. Everything a person types
 * is kept as text (a half-typed price is not a number yet); productOf turns
 * the draft into a real product, or says what is still wrong with it.
 */
export type VariantDraft = {
  /** Identifies the row on screen. Never sent anywhere. */
  rowId: string;
  sku: string;
  /** One value per option name, e.g. { Length: '18"' }. */
  options: Record<string, string>;
  /** Dollars, as typed: "189" or "189.95". */
  price: string;
  /** The optional "was" price, in dollars as typed. Empty for none. */
  compareAt: string;
  active: boolean;
};

export type ProductDraft = {
  id: string;
  name: string;
  category: CategorySlug;
  tagline: string;
  description: string;
  /** One highlight per line. */
  highlights: string;
  optionNames: string[];
  images: string[];
  status: Product["status"];
  featured: boolean;
  position: string;
  variants: VariantDraft[];
};

export const MAX_OPTIONS = 3;

let nextRow = 0;
const newRowId = () => `row-${nextRow++}`;

export function emptyVariant(optionNames: string[]): VariantDraft {
  return {
    rowId: newRowId(),
    sku: "",
    options: Object.fromEntries(optionNames.map((name) => [name, ""])),
    price: "",
    compareAt: "",
    active: true,
  };
}

/** A new product starts as a draft, so nothing half-finished reaches the shop. */
export function emptyDraft(): ProductDraft {
  return {
    id: "",
    name: "",
    category: "wigs",
    tagline: "",
    description: "",
    highlights: "",
    optionNames: [],
    images: [],
    status: "draft",
    featured: false,
    position: "10",
    variants: [emptyVariant([])],
  };
}

const dollarsOf = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

export function draftOf(product: Product): ProductDraft {
  return {
    ...product,
    highlights: product.highlights.join("\n"),
    position: String(product.position),
    variants: product.variants.map((variant) => ({
      rowId: newRowId(),
      sku: variant.sku,
      options: { ...variant.options },
      price: dollarsOf(variant.priceCents),
      compareAt: variant.compareAtCents === undefined ? "" : dollarsOf(variant.compareAtCents),
      active: variant.active,
    })),
  };
}

/** "189", "189.5", "$1,299.00" as cents. NaN for anything that is not a price. */
export function centsOf(typed: string): number {
  const cleaned = typed.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}

/** A product's address in the shop, suggested from its name: "Body Wave Wig" becomes "body-wave-wig". */
export function addressFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    // Accents are separate characters after normalising: drop them and keep the letter.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

function variantOf(draft: VariantDraft, optionNames: string[]): Variant {
  const compareAt = draft.compareAt.trim();
  return {
    sku: draft.sku.trim().toUpperCase(),
    options: Object.fromEntries(optionNames.map((name) => [name, (draft.options[name] ?? "").trim()])),
    priceCents: centsOf(draft.price),
    ...(compareAt !== "" && { compareAtCents: centsOf(compareAt) }),
    active: draft.active,
  };
}

export type Checked = { product: Product; problems: [] } | { product: null; problems: string[] };

/** The product the draft describes, or what has to be put right first, in the owner's words. */
export function productOf(draft: ProductDraft): Checked {
  const optionNames = draft.optionNames.map((name) => name.trim());
  const candidate = {
    id: draft.id.trim(),
    name: draft.name.trim(),
    category: draft.category,
    tagline: draft.tagline.trim(),
    description: draft.description.trim(),
    highlights: draft.highlights
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    optionNames,
    images: draft.images,
    status: draft.status,
    featured: draft.featured,
    position: /^\d+$/.test(draft.position.trim()) ? Number(draft.position) : Number.NaN,
    variants: draft.variants.map((variant) => variantOf(variant, optionNames)),
  };

  const problems = [...ownProblems(candidate), ...schemaProblems(candidate)];
  if (problems.length > 0) return { product: null, problems: [...new Set(problems)] };
  return { product: productSchema.parse(candidate), problems: [] };
}

type Candidate = { optionNames: string[]; variants: Variant[] };

/** Rules the shared product contract does not spell out, because only a person filling in a form can break them. */
function ownProblems({ optionNames, variants }: Candidate): string[] {
  const problems: string[] = [];
  if (new Set(optionNames.map((name) => name.toLowerCase())).size !== optionNames.length) {
    problems.push("Two options have the same name. Give each option its own name.");
  }
  variants.forEach((variant, index) => {
    const missing = optionNames.filter((name) => name !== "" && variant.options[name] === "");
    if (missing.length > 0) problems.push(`Row ${index + 1}: fill in ${missing.join(" and ")}.`);
  });
  const choices = variants.map((variant) => optionNames.map((name) => variant.options[name]).join(" / "));
  if (optionNames.length > 0 && new Set(choices).size !== choices.length) {
    problems.push("Two rows offer exactly the same choice. Each row must be a different combination.");
  }
  return problems;
}

function schemaProblems(candidate: unknown): string[] {
  const checked = productSchema.safeParse(candidate);
  if (checked.success) return [];
  return checked.error.issues.map((issue) => inPlainWords(issue.path, issue.message));
}

/** Says a contract violation the way the form labels things. `path` is where in the product it is, e.g. ["variants", 2, "priceCents"]. */
function inPlainWords(path: PropertyKey[], message: string): string {
  const [field, index, detail] = path;
  if (field === "variants" && typeof index === "number") {
    const row = `Row ${index + 1}`;
    if (detail === "priceCents") return `${row}: enter a price above zero, like 189 or 189.95.`;
    if (detail === "compareAtCents") return `${row}: the "was" price must be a price like 229, or left empty.`;
    if (detail === "sku") return message.startsWith("Duplicate") ? `${row}: this SKU is used by another row.` : `${row}: a SKU uses capital letters, numbers and hyphens, like WIG-BW-18.`;
    return `${row}: ${message}`;
  }
  if (field === "variants") return "A product needs at least one row of options and prices.";
  if (field === "id") return "The shop address uses lowercase letters, numbers and hyphens, like body-wave-wig.";
  if (field === "name") return "Give the product a name (up to 120 characters).";
  if (field === "position") return "Position is a whole number from 0 to 999999.";
  if (field === "optionNames") return "Each option needs a name of up to 40 characters, such as Length.";
  if (field === "highlights") return "At most 12 highlights, each up to 200 characters.";
  if (field === "tagline") return "The tagline can be up to 200 characters.";
  if (field === "description") return "The description can be up to 4000 characters.";
  return `${String(field)}: ${message}`;
}

/** The draft with an option added: every row gains an empty value for it. */
export function withOptionAdded(draft: ProductDraft): ProductDraft {
  // A placeholder name that cannot clash with one already typed.
  let name = "";
  for (let n = draft.optionNames.length + 1; name === "" || draft.optionNames.includes(name); n++) name = `Option ${n}`;
  return {
    ...draft,
    optionNames: [...draft.optionNames, name],
    variants: draft.variants.map((variant) => ({ ...variant, options: { ...variant.options, [name]: "" } })),
  };
}

/** The draft with an option renamed, keeping what each row has for it. */
export function withOptionRenamed(draft: ProductDraft, index: number, name: string): ProductDraft {
  const previous = draft.optionNames[index]!;
  // Two options may not share a name even for a keystroke: their values would merge.
  if (draft.optionNames.some((other, at) => at !== index && other === name)) return draft;
  return {
    ...draft,
    optionNames: draft.optionNames.map((existing, at) => (at === index ? name : existing)),
    variants: draft.variants.map((variant) => {
      const { [previous]: value = "", ...others } = variant.options;
      return { ...variant, options: { ...others, [name]: value } };
    }),
  };
}

/** The draft with an option removed, along with what each row had for it. */
export function withOptionRemoved(draft: ProductDraft, index: number): ProductDraft {
  const removed = draft.optionNames[index]!;
  return {
    ...draft,
    optionNames: draft.optionNames.filter((_, at) => at !== index),
    variants: draft.variants.map((variant) => ({
      ...variant,
      options: Object.fromEntries(Object.entries(variant.options).filter(([name]) => name !== removed)),
    })),
  };
}
