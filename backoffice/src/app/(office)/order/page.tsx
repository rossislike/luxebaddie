"use client";

import type { Order } from "@luxebaddie/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { History } from "@/activity/history";
import { LoadState } from "@/components/load-state";
import { useLoaded } from "@/lib/use-loaded";
import { getOrder } from "@/orders/api";
import { STATUS_NAMES } from "@/orders/fulfillment";
import { FulfillmentPanel } from "@/orders/fulfillment-panel";
import { OrderDetails } from "@/orders/order-details";

export default function OrderPage() {
  return (
    // Which order to show comes from the address, which only the browser knows.
    <Suspense>
      <OrderByNumber />
    </Suspense>
  );
}

function OrderByNumber() {
  const orderId = useSearchParams().get("id") ?? "";
  const loaded = useLoaded(useCallback(() => getOrder(orderId), [orderId]));

  return (
    <>
      <p className="eyebrow">
        <Link href="/orders">Orders</Link>
      </p>
      <LoadState loaded={loaded}>{(order) => <LoadedOrder key={order.id} loaded={order} />}</LoadState>
    </>
  );
}

/** Shows the order, and after each fulfillment step shows it as the server returned it. */
function LoadedOrder({ loaded }: { loaded: Order }) {
  const [order, setOrder] = useState(loaded);

  return (
    <>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="font-display text-4xl" data-testid="order-number">
          {order.id}
        </h1>
        <p className="border border-ink/25 px-3 py-1 text-sm" data-testid="order-status">
          {STATUS_NAMES[order.fulfillmentStatus]}
        </p>
      </div>
      <div className="mt-8 space-y-6">
        <FulfillmentPanel order={order} onChanged={setOrder} />
        <OrderDetails order={order} />
        {/* Keyed by status, so the history is read again after each fulfillment step. */}
        <History key={`${order.fulfillmentStatus}-${order.shipment?.trackingNumber}`} kind="order" id={order.id} />
      </div>
    </>
  );
}
