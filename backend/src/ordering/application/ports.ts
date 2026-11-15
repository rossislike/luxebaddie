import type { Activity, FulfillmentStatus, Order, Page } from "@luxebaddie/contracts";
import type { PageRequest } from "../../shared/paging";

export type SaveOutcome = "created" | "already_exists";

/** "changed_meanwhile": the order was no longer in the state the change started from, so nothing was stored. */
export type FulfillmentSaveOutcome = "saved" | "changed_meanwhile";

export type { PageRequest } from "../../shared/paging";

/** Where orders are kept. Implemented by an adapter (DynamoDB today). */
export interface OrderRepository {
  /** Stores the order unless one with the same id exists. Never overwrites. */
  saveIfNew(order: Order): Promise<SaveOutcome>;
  findById(id: string): Promise<Order | null>;
  /**
   * Stores the order's fulfillment progress, provided the stored order is
   * still in the `from` state. Two people working the same order therefore
   * cannot both move it: the second is told it changed. The activity log
   * entry is stored with the change, or not at all.
   */
  saveFulfillment(order: Order, from: FulfillmentStatus, activity: Activity): Promise<FulfillmentSaveOutcome>;
  /** Orders in a fulfillment state, oldest first: the fulfillment work queue. */
  findByFulfillmentStatus(status: FulfillmentStatus, page: PageRequest): Promise<Page<Order>>;
  /** One customer's orders, newest first. */
  findByCustomerEmail(email: string, page: PageRequest): Promise<Page<Order>>;
}
