import type { FulfillmentStatus, Order, Page } from "@luxebaddy/contracts";

export type SaveOutcome = "created" | "already_exists";

/** Which page of a list to read. `cursor` comes from the previous page's `nextCursor`. */
export type PageRequest = {
  limit: number;
  cursor?: string;
};

/** Where orders are kept. Implemented by an adapter (DynamoDB today). */
export interface OrderRepository {
  /** Stores the order unless one with the same id exists. Never overwrites. */
  saveIfNew(order: Order): Promise<SaveOutcome>;
  findById(id: string): Promise<Order | null>;
  /** Orders in a fulfillment state, oldest first: the fulfillment work queue. */
  findByFulfillmentStatus(status: FulfillmentStatus, page: PageRequest): Promise<Page<Order>>;
  /** One customer's orders, newest first. */
  findByCustomerEmail(email: string, page: PageRequest): Promise<Page<Order>>;
}
