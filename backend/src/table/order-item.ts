import type { FulfillmentStatus, Order } from "@luxebaddie/contracts";
import { applicationAttributes, assertType, type TableItem, type TableKey } from "./schema";

/**
 * Order item. Line items are embedded: an order comes from a basket, which is
 * capped at 30 lines, and its lines are only ever read with the order.
 *
 *   PK / SK   ORDER#<orderId>
 *   GSI1PK    CUSTOMER#<email>                 a customer's orders...
 *   GSI1SK    ORDER#<paidAt>#<orderId>         ...by date
 *   GSI2PK    FULFILLMENT#<fulfillmentStatus>  the fulfillment queue...
 *   GSI2SK    ORDER#<createdAt>#<orderId>      ...oldest first
 *
 * The base key is the order number alone, so a paid checkout can be recorded
 * exactly once (a conditional put) and looked up with nothing but the number.
 * Order numbers are not time-ordered, so the index sort keys lead with a
 * timestamp and end with the order number to stay unique.
 */
export function orderKey(orderId: string): TableKey {
  return { PK: `ORDER#${orderId}`, SK: `ORDER#${orderId}` };
}

/** Emails are matched case-insensitively; the order keeps the email as the customer typed it. */
export function customerPartition(email: string): string {
  return `CUSTOMER#${email.trim().toLowerCase()}`;
}

export function fulfillmentPartition(status: FulfillmentStatus): string {
  return `FULFILLMENT#${status}`;
}

/** Orders without an email simply do not appear in any customer's collection. */
function customerIndexKeys(order: Order) {
  if (!order.email) return {};
  return { GSI1PK: customerPartition(order.email), GSI1SK: `ORDER#${order.paidAt}#${order.id}` };
}

/**
 * Must be rewritten whenever fulfillmentStatus changes, in the same update,
 * or the order stays in its old queue.
 */
export function fulfillmentIndexKeys(order: Pick<Order, "id" | "fulfillmentStatus" | "createdAt">) {
  return {
    GSI2PK: fulfillmentPartition(order.fulfillmentStatus),
    GSI2SK: `ORDER#${order.createdAt}#${order.id}`,
  };
}

export function orderToItem(order: Order): TableItem {
  return {
    ...orderKey(order.id),
    ...customerIndexKeys(order),
    ...fulfillmentIndexKeys(order),
    Type: "Order",
    ...order,
  };
}

export function orderFromItem(item: Record<string, unknown>): Order {
  assertType(item, "Order");
  return applicationAttributes<Order>(item);
}
