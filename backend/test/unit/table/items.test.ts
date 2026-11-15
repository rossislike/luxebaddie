import type { Activity, Order, Product } from "@luxebaddie/contracts";
import { activityFromItem, activityToItem } from "../../../src/table/activity-item";
import { describe, expect, it } from "vitest";
import { seedProducts } from "../../../scripts/seed-data";
import { orderFromCheckout } from "../../../src/ordering/domain/order";
import { basketKey, basketLinesFromItem, basketToItem } from "../../../src/table/basket-item";
import { decodeCursor, encodeCursor } from "../../../src/table/cursor";
import { fulfillmentAttributes, orderFromItem, orderKey, orderToItem } from "../../../src/table/order-item";
import { catalogPrefix, productFromItem, productKey, productToItem } from "../../../src/table/product-item";
import { BASKET_ID, lashes, paidCheckout, wig } from "../fixtures";

const order: Order = orderFromCheckout(paidCheckout, new Date("2026-11-14T12:00:05.000Z"));

describe("Product items", () => {
  it("survive a round trip through the table unchanged", () => {
    for (const product of [wig, lashes, ...seedProducts]) {
      expect(productFromItem(productToItem(product))).toEqual(product);
    }
  });

  it("are keyed by product id and join the catalog collection", () => {
    expect(productToItem(wig)).toMatchObject({
      PK: "PRODUCT#test-wig",
      SK: "PRODUCT#test-wig",
      GSI1PK: "CATALOG",
      GSI1SK: "PRODUCT#active#wigs#000001#test-wig",
      Type: "Product",
    });
    expect(productKey("test-wig")).toEqual({ PK: "PRODUCT#test-wig", SK: "PRODUCT#test-wig" });
  });

  it("sort within a category by position as a number, not as text", () => {
    const at = (position: number): Product => ({ ...wig, id: `wig-${position}`, position });
    const sortKeys = [at(10), at(9), at(100)].map((product) => String(productToItem(product).GSI1SK)).sort();

    expect(sortKeys.map((key) => key.split("#").at(-1))).toEqual(["wig-9", "wig-10", "wig-100"]);
  });

  it("can be selected by status, or by status and category, with a key prefix", () => {
    const draft: Product = { ...wig, id: "draft-wig", status: "draft" };
    const keyOf = (product: Product) => String(productToItem(product).GSI1SK);

    expect(keyOf(wig).startsWith(catalogPrefix("active"))).toBe(true);
    expect(keyOf(wig).startsWith(catalogPrefix("active", "wigs"))).toBe(true);
    expect(keyOf(lashes).startsWith(catalogPrefix("active", "wigs"))).toBe(false);
    expect(keyOf(draft).startsWith(catalogPrefix("active"))).toBe(false);
    expect(keyOf(draft).startsWith(catalogPrefix())).toBe(true);
  });

  it("refuse to be read from an item of another type", () => {
    expect(() => productFromItem(orderToItem(order))).toThrow(/Expected a Product item/);
  });
});

describe("Basket items", () => {
  const lines = [{ productId: "test-wig", sku: "TW-16", quantity: 2 }];
  const savedAt = new Date("2026-11-01T00:00:00.000Z");
  const item = basketToItem(BASKET_ID, lines, savedAt);

  it("are keyed by basket id and expire 30 days after the last change", () => {
    expect(item).toMatchObject({
      ...basketKey(BASKET_ID),
      PK: `BASKET#${BASKET_ID}`,
      Type: "Basket",
      TTL: Date.parse("2026-12-01T00:00:00.000Z") / 1000,
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
  });

  it("return their lines while the basket is live", () => {
    expect(basketLinesFromItem(item, new Date("2026-11-15T00:00:00.000Z"))).toEqual(lines);
  });

  it("read as empty once expired, even if DynamoDB has not deleted the item yet", () => {
    expect(basketLinesFromItem(item, new Date("2026-12-01T00:00:01.000Z"))).toEqual([]);
  });

  it("read as empty when there is no item", () => {
    expect(basketLinesFromItem(undefined, savedAt)).toEqual([]);
  });
});

describe("Order items", () => {
  const item = orderToItem(order);

  it("survive a round trip through the table unchanged", () => {
    expect(orderFromItem(item)).toEqual(order);
  });

  it("are keyed by order number alone, so a payment can only be recorded once", () => {
    expect(item).toMatchObject({ ...orderKey(order.id), PK: `ORDER#${order.id}`, Type: "Order" });
  });

  it("join their customer's collection by lower-cased email, sorted by payment date", () => {
    const shouting = orderToItem({ ...order, email: " Buyer@Example.COM " });

    expect(shouting.GSI1PK).toBe("CUSTOMER#buyer@example.com");
    expect(shouting.GSI1SK).toBe(`ORDER#2026-11-14T12:00:00.000Z#${order.id}`);
    expect(shouting.email).toBe(" Buyer@Example.COM ");
  });

  it("stay out of every customer collection when there is no email", () => {
    const anonymous = orderToItem({ ...order, email: null });

    expect(anonymous).not.toHaveProperty("GSI1PK");
    expect(anonymous).not.toHaveProperty("GSI1SK");
  });

  it("read as not yet fulfilled when they were stored before fulfillment was tracked", () => {
    const { vendorOrderReference, orderedFromVendorAt, shipment, shippedAt, deliveredAt, ...storedBefore } = item;

    expect(orderFromItem(storedBefore)).toEqual(order);
  });

  it("rewrite their queue keys along with their progress when fulfillment changes", () => {
    const shipped: Order = {
      ...order,
      fulfillmentStatus: "shipped",
      shipment: { carrier: "USPS", trackingNumber: "9400111899223197428490" },
      shippedAt: "2026-11-15T09:30:00.000Z",
    };

    expect(fulfillmentAttributes(shipped)).toEqual({
      GSI2PK: "FULFILLMENT#shipped",
      GSI2SK: `ORDER#2026-11-14T12:00:05.000Z#${order.id}`,
      fulfillmentStatus: "shipped",
      vendorOrderReference: null,
      orderedFromVendorAt: null,
      shipment: shipped.shipment,
      shippedAt: "2026-11-15T09:30:00.000Z",
      deliveredAt: null,
    });
  });

  it("join the fulfillment queue for their status, oldest first", () => {
    expect(item.GSI2PK).toBe("FULFILLMENT#unfulfilled");
    expect(item.GSI2SK).toBe(`ORDER#2026-11-14T12:00:05.000Z#${order.id}`);
    expect(orderToItem({ ...order, fulfillmentStatus: "shipped" }).GSI2PK).toBe("FULFILLMENT#shipped");
  });
});

describe("Activity items", () => {
  const entry: Activity = {
    id: "0b6b1c5e-7f0a-4c58-9a44-5d3f1f0d9c11",
    at: "2026-11-15T09:30:00.000Z",
    actor: { kind: "owner", email: "owner@example.com" },
    action: "order.shipped",
    subject: { kind: "order", id: "LB-7K3M9Q2XAB", label: "LB-7K3M9Q2XAB" },
    note: "USPS 9400111899223197428490",
  };
  const item = activityToItem(entry);

  it("survive a round trip through the table unchanged", () => {
    expect(activityFromItem(item)).toEqual(entry);
  });

  it("all join one log, in the order things happened", () => {
    const later = activityToItem({ ...entry, id: "a", at: "2026-11-15T09:30:00.001Z" });

    expect(item).toMatchObject({ PK: "ACTIVITY", SK: `ACTIVITY#${entry.at}#${entry.id}`, Type: "Activity" });
    expect(String(item.SK) < String(later.SK)).toBe(true);
  });

  it("stay apart when two changes share a millisecond", () => {
    expect(activityToItem({ ...entry, id: "another" }).SK).not.toBe(item.SK);
  });

  it("also join the history of the product or order they are about", () => {
    const aboutProduct = activityToItem({ ...entry, action: "product.saved", subject: { kind: "product", id: "body-wave-wig", label: "Body Wave Wig" } });

    expect(item.GSI1PK).toBe("ACTIVITY#ORDER#LB-7K3M9Q2XAB");
    expect(item.GSI1SK).toBe(item.SK);
    expect(aboutProduct.GSI1PK).toBe("ACTIVITY#PRODUCT#body-wave-wig");
  });

  it("cannot be mistaken for a customer's orders, which share the index", () => {
    expect(String(item.GSI1PK).startsWith("CUSTOMER#")).toBe(false);
    expect(String(item.GSI1SK).startsWith("ORDER#")).toBe(false);
  });
});

describe("cursors", () => {
  it("carry DynamoDB's last evaluated key to the next request", () => {
    const lastEvaluatedKey = { PK: "ORDER#LB-1", SK: "ORDER#LB-1", GSI2PK: "FULFILLMENT#unfulfilled", GSI2SK: "ORDER#x" };
    expect(decodeCursor(encodeCursor(lastEvaluatedKey)!)).toEqual(lastEvaluatedKey);
  });

  it("are absent on the last page and on the first request", () => {
    expect(encodeCursor(undefined)).toBeNull();
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it("reject anything that is not a cursor we issued", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow("Invalid cursor");
    expect(() => decodeCursor(Buffer.from('"just a string"').toString("base64url"))).toThrow("Invalid cursor");
  });
});
