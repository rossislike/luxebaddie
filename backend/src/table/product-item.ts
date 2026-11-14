import { MAX_POSITION, type CategorySlug, type Product } from "@luxebaddie/contracts";
import { applicationAttributes, assertType, type TableItem, type TableKey, zeroPad } from "./schema";

/**
 * Product item. Variants are embedded: a product has at most 100, and they are
 * only ever read together with their product.
 *
 *   PK / SK   PRODUCT#<id>
 *   GSI1PK    CATALOG
 *   GSI1SK    PRODUCT#<status>#<category>#<position>#<id>
 *
 * Every product shares the CATALOG partition in GSI1, sorted so that one Query
 * can read "everything", "everything for sale" or "one category for sale" by
 * prefix. Status, category and position can change, which is why they live in
 * an index key and not in the base table key.
 */
export const CATALOG_PARTITION = "CATALOG";

const POSITION_WIDTH = String(MAX_POSITION).length;

export function productKey(id: string): TableKey {
  return { PK: `PRODUCT#${id}`, SK: `PRODUCT#${id}` };
}

/** Sort key prefix selecting part of the catalog. Narrower with each argument given. */
export function catalogPrefix(status?: Product["status"], category?: CategorySlug): string {
  if (!status) return "PRODUCT#";
  if (!category) return `PRODUCT#${status}#`;
  return `PRODUCT#${status}#${category}#`;
}

export function productToItem(product: Product): TableItem {
  const position = zeroPad(product.position, POSITION_WIDTH);
  return {
    ...productKey(product.id),
    GSI1PK: CATALOG_PARTITION,
    GSI1SK: `${catalogPrefix(product.status, product.category)}${position}#${product.id}`,
    Type: "Product",
    ...product,
  };
}

export function productFromItem(item: Record<string, unknown>): Product {
  assertType(item, "Product");
  return applicationAttributes<Product>(item);
}
