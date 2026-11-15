import type { FulfillmentStatus, FulfillmentStep, Order, Shipment } from "@luxebaddie/contracts";
import { backOfficeFetch } from "@/lib/api";

/** One page of orders, with the cursor for the next (null on the last page). */
export type OrderPage = { orders: Order[]; nextCursor: string | null };

const PAGE_SIZE = 25;

const paging = (cursor: string | null) => `limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
const orderPath = (orderId: string) => `/order/${encodeURIComponent(orderId)}`;

/** One work queue, oldest order first. */
export const listQueue = (status: FulfillmentStatus, cursor: string | null) =>
  backOfficeFetch<OrderPage>(`/order?fulfillmentStatus=${status}&${paging(cursor)}`);

/** One customer's orders, newest first. */
export const listCustomerOrders = (email: string, cursor: string | null) =>
  backOfficeFetch<OrderPage>(`/customer/${encodeURIComponent(email)}/order?${paging(cursor)}`);

export const getOrder = async (orderId: string) => (await backOfficeFetch<{ order: Order }>(orderPath(orderId))).order;

export const takeFulfillmentStep = async (orderId: string, step: FulfillmentStep) =>
  (await backOfficeFetch<{ order: Order }>(`${orderPath(orderId)}/fulfillment-step`, { method: "POST", json: step })).order;

export const correctShipment = async (orderId: string, shipment: Shipment) =>
  (await backOfficeFetch<{ order: Order }>(`${orderPath(orderId)}/shipment`, { method: "PUT", json: shipment })).order;
