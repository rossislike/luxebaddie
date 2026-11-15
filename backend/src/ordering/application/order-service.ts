import type {
  ActivityAction,
  Actor,
  CheckoutCompleted,
  FulfillmentStatus,
  FulfillmentStep,
  Order,
  OrderConfirmation,
  Shipment,
} from "@luxebaddie/contracts";
import { activityFor } from "../../shared/activity";
import { conflict, notFound } from "../../shared/errors";
import { correctShipment, takeStep, whyShipmentCorrectionIsRefused, whyStepIsRefused } from "../domain/fulfillment";
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

  /** Stores a change to an order's fulfillment that was worked out from `before`, with its entry in the activity log. */
  async function saveFulfillment(before: Order, after: Order, change: FulfillmentChange): Promise<Order> {
    const activity = activityFor({ ...change, subject: { kind: "order", id: after.id, label: after.id } }, now());
    const outcome = await orders.saveFulfillment(after, before.fulfillmentStatus, activity);
    if (outcome === "changed_meanwhile") {
      throw conflict(`Order ${before.id} was changed by someone else a moment ago. Reload it and try again.`);
    }
    return after;
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

    /** Moves an order one step towards the customer. Refused, with the reason, if that is not the order's next step. */
    async takeFulfillmentStep(orderId: string, step: FulfillmentStep, actor: Actor): Promise<Order> {
      const order = await getOrder(orderId);
      const refusal = whyStepIsRefused(order, step);
      if (refusal) throw conflict(refusal);
      const moved = takeStep(order, step, now());
      return saveFulfillment(order, moved, { actor, action: `order.${step.step}`, note: noteFor(step, moved) });
    },

    /** Replaces the carrier and tracking number of an order that is on its way. */
    async correctShipment(orderId: string, shipment: Shipment, actor: Actor): Promise<Order> {
      const order = await getOrder(orderId);
      const refusal = whyShipmentCorrectionIsRefused(order);
      if (refusal) throw conflict(refusal);
      const change = { actor, action: "order.shipment-corrected", note: inWords(shipment) } as const;
      return saveFulfillment(order, correctShipment(order, shipment), change);
    },
  };
}

type FulfillmentChange = { actor: Actor; action: ActivityAction; note: string | null };

const inWords = (shipment: Shipment) => `${shipment.carrier} ${shipment.trackingNumber}`;

/** The detail worth keeping about a step: what the owner typed in when taking it. */
function noteFor(step: FulfillmentStep, moved: Order): string | null {
  if (step.step === "ordered-from-vendor") return moved.vendorOrderReference && `Vendor order ${moved.vendorOrderReference}`;
  if (step.step === "shipped") return inWords(step.shipment);
  return null;
}

export type OrderService = ReturnType<typeof createOrderService>;
