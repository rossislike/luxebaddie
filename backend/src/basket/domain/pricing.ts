import {
  type BasketItem,
  type PricedBasket,
  type PricedLine,
  type Product,
  variantTitle,
} from "@luxebaddy/contracts";
import { FREE_SHIPPING_THRESHOLD_CENTS, shippingCentsFor } from "./shipping";

/**
 * Applies current catalog prices to a basket. The browser only ever sends
 * product ids, SKUs and quantities; prices always come from the catalog here,
 * so a tampered request cannot change what the shopper pays.
 *
 * Items whose product or variant is no longer sold are reported in `removed`.
 */
export function priceBasket(id: string, items: BasketItem[], products: Map<string, Product>): PricedBasket {
  const lines: PricedLine[] = [];
  const removed: BasketItem[] = [];

  for (const item of mergeDuplicates(items)) {
    const line = priceLine(item, products.get(item.productId));
    if (line) lines.push(line);
    else removed.push(item);
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  return {
    id,
    lines,
    subtotalCents,
    shippingCents: lines.length > 0 ? shippingCentsFor(subtotalCents) : 0,
    freeShippingThresholdCents: FREE_SHIPPING_THRESHOLD_CENTS,
    removed,
  };
}

/** The priced line, or null when the item is not for sale. */
function priceLine(item: BasketItem, product: Product | undefined): PricedLine | null {
  const variant = product?.variants.find((v) => v.sku === item.sku);
  if (!product || product.status !== "active" || !variant?.active) return null;
  return {
    ...item,
    productName: product.name,
    variantTitle: variantTitle(product, variant),
    unitPriceCents: variant.priceCents,
    lineTotalCents: variant.priceCents * item.quantity,
    image: product.images[0] ?? null,
  };
}

/** Collapses repeated productId + sku pairs into one line, keeping first-seen order. */
function mergeDuplicates(items: BasketItem[]): BasketItem[] {
  const merged = new Map<string, BasketItem>();
  for (const item of items) {
    const key = `${item.productId}#${item.sku}`;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, quantity: existing.quantity + item.quantity } : { ...item });
  }
  return [...merged.values()];
}

export function itemsOf(basket: PricedBasket): BasketItem[] {
  return basket.lines.map(({ productId, sku, quantity }) => ({ productId, sku, quantity }));
}
