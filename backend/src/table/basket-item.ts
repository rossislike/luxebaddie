import type { BasketItem } from "@luxebaddy/contracts";
import { assertType, type TableItem, type TableKey } from "./schema";

/**
 * Basket item. Lines are embedded: a basket is capped at 30 lines and is only
 * ever read whole.
 *
 *   PK / SK   BASKET#<basketId>     (the anonymous UUID the browser holds)
 *   TTL       abandoned baskets delete themselves
 */
const ABANDONED_BASKET_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const epochSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export function basketKey(basketId: string): TableKey {
  return { PK: `BASKET#${basketId}`, SK: `BASKET#${basketId}` };
}

export function basketToItem(basketId: string, items: BasketItem[], now: Date): TableItem {
  const expiresAt = new Date(now.getTime() + ABANDONED_BASKET_LIFETIME_SECONDS * 1000);
  return {
    ...basketKey(basketId),
    Type: "Basket",
    TTL: epochSeconds(expiresAt),
    basketId,
    items,
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * The basket's lines. DynamoDB removes expired items lazily (it can take days),
 * so an expired basket that is still stored is treated as already gone.
 */
export function basketLinesFromItem(item: Record<string, unknown> | undefined, now: Date): BasketItem[] {
  if (!item) return [];
  assertType(item, "Basket");
  const isExpired = typeof item.TTL === "number" && item.TTL <= epochSeconds(now);
  return isExpired ? [] : ((item.items as BasketItem[] | undefined) ?? []);
}
