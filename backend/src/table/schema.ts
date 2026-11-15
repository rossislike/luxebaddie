/**
 * The single DynamoDB table every service stores its data in.
 * The full model (entities, keys, access patterns) is in backend/DATA-MODEL.md.
 *
 * Attributes fall into two groups that are never mixed:
 *  - indexing attributes (below): exist only to place an item in the right
 *    item collections and sort order. No business meaning.
 *  - application attributes: the business data, exactly as in the contracts.
 * Business values are never read back out of a key.
 */
export const GSI1 = "GSI1";
export const GSI2 = "GSI2";

/** Expiry in epoch seconds. DynamoDB deletes the item some time after this passes. */
export const TTL_ATTRIBUTE = "TTL";

export type EntityType = "Product" | "Basket" | "Order" | "Activity";

export type IndexingAttributes = {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  Type: EntityType;
  TTL?: number;
};

export type TableItem = IndexingAttributes & Record<string, unknown>;
export type TableKey = Pick<IndexingAttributes, "PK" | "SK">;

/** The application attributes of an item: everything except the indexing attributes. */
export function applicationAttributes<T>(item: Record<string, unknown>): T {
  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, Type, TTL, ...attributes } = item;
  return attributes as T;
}

export function assertType(item: Record<string, unknown>, expected: EntityType): void {
  if (item.Type !== expected) {
    throw new Error(`Expected a ${expected} item but found ${String(item.Type)} at ${String(item.PK)}`);
  }
}

/** Numbers inside string sort keys must be fixed-width, or "10" sorts before "9". */
export function zeroPad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
