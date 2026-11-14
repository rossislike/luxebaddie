import type { CheckoutCompleted, FulfillmentStatus, Order, OrderConfirmation } from "@luxebaddy/contracts";
import { notFound } from "../../shared/errors";
import { confirmationOf, orderFromCheckout, orderIdForSession } from "../domain/order";
import type { OrderRepository, PageRequest, SaveOutcome } from "./ports";

interface OrderPorts {
  orders: OrderRepository;
  now?: () => Date;
}

/** Ordering use cases: the record of what was sold. */
export function createOrderService({ orders, now = () => new Date() }: OrderPorts) {
  async function getOrder(id: string): Promise<Order> {
    const order = await orders.findById(id);
    if (!order) throw notFound("Order");
    return order;
  }

  /**
   * Two different payments mapping to one order number is astronomically
   * unlikely, but it must fail loudly rather than silently drop a paid order.
   */
  async function assertSamePurchase(order: Order): Promise<void> {
    const existing = await orders.findById(order.id);
    if (existing?.checkoutSessionId !== order.checkoutSessionId) {
      throw new Error(`Order id collision on ${order.id} for session ${order.checkoutSessionId}`);
    }
  }

  return {
    /** Idempotent: recording the same paid checkout again changes nothing. */
    async recordPaidCheckout(checkout: CheckoutCompleted): Promise<{ orderId: string; outcome: SaveOutcome }> {
      const order = orderFromCheckout(checkout, now());
      const outcome = await orders.saveIfNew(order);
      if (outcome === "already_exists") await assertSamePurchase(order);
      return { orderId: order.id, outcome };
    },

    /** The session id is a long random secret only the buyer's browser holds. */
    async getConfirmation(checkoutSessionId: string): Promise<OrderConfirmation> {
      return confirmationOf(await getOrder(orderIdForSession(checkoutSessionId)));
    },

    getOrder,

    listByFulfillmentStatus: (status: FulfillmentStatus, page: PageRequest) =>
      orders.findByFulfillmentStatus(status, page),

    listForCustomer: (email: string, page: PageRequest) => orders.findByCustomerEmail(email, page),
  };
}

export type OrderService = ReturnType<typeof createOrderService>;
