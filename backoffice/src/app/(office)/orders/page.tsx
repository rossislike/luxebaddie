"use client";

import { fulfillmentStatusSchema } from "@luxebaddie/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { listQueue } from "@/orders/api";
import { QUEUES } from "@/orders/fulfillment";
import { OrderSearch } from "@/orders/order-search";
import { OrderTable } from "@/orders/order-table";
import { useOrderList } from "@/orders/use-order-list";

export default function OrdersPage() {
  return (
    // The queue being shown comes from the address, which only the browser knows.
    <Suspense>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const requested = fulfillmentStatusSchema.safeParse(useSearchParams().get("queue"));
  const queue = QUEUES.find(({ status }) => status === requested.data) ?? QUEUES[0]!;
  const list = useOrderList(useCallback((cursor: string | null) => listQueue(queue.status, cursor), [queue.status]));

  return (
    <>
      <p className="eyebrow">Orders</p>
      <h1 className="mt-2 font-display text-4xl">{queue.name}</h1>
      <div className="mt-6">
        <OrderSearch />
      </div>
      <nav aria-label="Order queues" className="mt-8 flex flex-wrap gap-2">
        {QUEUES.map(({ status, name }) => (
          <Link
            key={status}
            href={`/orders?queue=${status}`}
            aria-current={status === queue.status ? "page" : undefined}
            className="flex min-h-11 items-center border border-ink/25 px-4 text-sm aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-cream"
          >
            {name}
          </Link>
        ))}
      </nav>
      <p className="mt-6 mb-3 text-sm text-cocoa">Oldest first.</p>
      <OrderTable list={list} emptyMessage={queue.emptyMessage} />
    </>
  );
}
