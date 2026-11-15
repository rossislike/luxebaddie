import { formatMoney, type Order } from "@luxebaddie/contracts";
import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import { STATUS_NAMES } from "./fulfillment";
import { orderPage } from "./search";
import type { OrderList } from "./use-order-list";

const itemCount = (order: Order) => order.items.reduce((sum, item) => sum + item.quantity, 0);

/** A list of orders with a "show more" button, and what to say while it loads, fails or is empty. */
export function OrderTable({ list, emptyMessage, showStatus = false }: { list: OrderList; emptyMessage: string; showStatus?: boolean }) {
  if (list.loading) return <p className="text-cocoa">Loading orders...</p>;

  return (
    <>
      {list.items.length === 0 && !list.error && <p className="text-cocoa" data-testid="no-orders">{emptyMessage}</p>}
      {list.items.length > 0 && (
        <ul className="panel divide-y divide-ink/10" data-testid="order-list">
          {list.items.map((order) => (
            <li key={order.id}>
              <Link href={orderPage(order.id)} className="grid gap-x-6 gap-y-1 px-5 py-4 hover:bg-sand/50 sm:grid-cols-[9rem_1fr_auto]">
                <span className="font-medium" data-testid="order-number">{order.id}</span>
                <span className="min-w-0">
                  <span className="block truncate">{order.shippingName ?? order.customerName ?? order.email ?? "No name given"}</span>
                  <span className="block text-sm text-cocoa">
                    Paid {formatDateTime(order.paidAt)} · {itemCount(order)} {itemCount(order) === 1 ? "item" : "items"}
                    {showStatus && ` · ${STATUS_NAMES[order.fulfillmentStatus]}`}
                  </span>
                </span>
                <span className="sm:text-right">{formatMoney(order.totalCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.error && (
        <p role="alert" className="mt-4 border border-wine/30 bg-blush/50 px-4 py-3 text-sm text-wine">
          {list.error}
        </p>
      )}
      {(list.hasMore || list.error) && (
        <button type="button" className="btn btn-outline mt-6" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? "Loading..." : list.error ? "Try again" : "Show more"}
        </button>
      )}
    </>
  );
}
