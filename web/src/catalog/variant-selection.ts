import type { Product, Variant } from "@luxebaddie/contracts";

export type Selection = Record<string, string>;

type Options = Pick<Product, "optionNames" | "variants">;

const activeVariants = (product: Options) => product.variants.filter((v) => v.active);

/** The option values to offer for each option, in catalog order. */
export function optionValues(product: Options): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  for (const name of product.optionNames) {
    values[name] = [...new Set(activeVariants(product).map((v) => v.options[name]!))];
  }
  return values;
}

/** The variant matching every selected option, if it is for sale. */
export function findVariant(product: Options, selection: Selection): Variant | null {
  return (
    activeVariants(product).find((v) => product.optionNames.every((name) => v.options[name] === selection[name])) ??
    null
  );
}

/** Start on the first variant for sale. */
export function defaultSelection(product: Options): Selection {
  return { ...(activeVariants(product)[0]?.options ?? {}) };
}

/**
 * Whether choosing `value` for `name` leads to a variant that exists, given the
 * other current choices. Used to grey out combinations that are not sold.
 */
export function isSelectable(product: Options, selection: Selection, name: string, value: string): boolean {
  return findVariant(product, { ...selection, [name]: value }) !== null;
}

/**
 * Applies a choice. If the exact combination is not sold, falls back to the
 * first variant that has the chosen value so the shopper never lands on nothing.
 */
export function select(product: Options, selection: Selection, name: string, value: string): Selection {
  const next = { ...selection, [name]: value };
  if (findVariant(product, next)) return next;
  const fallback = activeVariants(product).find((v) => v.options[name] === value);
  return fallback ? { ...fallback.options } : selection;
}
