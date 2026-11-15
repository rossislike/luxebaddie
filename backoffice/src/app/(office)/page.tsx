"use client";

import type { Order, Page, Product } from "@luxebaddie/contracts";
import { LoadState } from "@/components/load-state";
import { backOfficeFetch } from "@/lib/api";
import { useLoaded } from "@/lib/use-loaded";

/** As many waiting orders as the home page counts exactly. Beyond this it says "100+". */
const COUNT_UP_TO = 100;

type Overview = { waitingOrders: number; moreWaiting: boolean; productsForSale: number; draftProducts: number };

async function loadOverview(): Promise<Overview> {
  const [queue, catalog] = await Promise.all([
    backOfficeFetch<{ orders: Order[]; nextCursor: Page<Order>["nextCursor"] }>(
      `/order?fulfillmentStatus=unfulfilled&limit=${COUNT_UP_TO}`,
    ),
    backOfficeFetch<{ products: Product[] }>("/product"),
  ]);
  const forSale = catalog.products.filter((product) => product.status === "active").length;
  return {
    waitingOrders: queue.orders.length,
    moreWaiting: queue.nextCursor !== null,
    productsForSale: forSale,
    draftProducts: catalog.products.length - forSale,
  };
}

export default function HomePage() {
  const overview = useLoaded(loadOverview);

  return (
    <>
      <p className="eyebrow">Today</p>
      <h1 className="mt-2 font-display text-4xl">Back office</h1>
      <div className="mt-8">
        <LoadState loaded={overview}>
          {({ waitingOrders, moreWaiting, productsForSale, draftProducts }) => (
            <dl className="grid gap-4 sm:grid-cols-3">
              <Figure label="Orders waiting to be fulfilled" value={`${waitingOrders}${moreWaiting ? "+" : ""}`} testId="waiting-orders" />
              <Figure label="Products for sale" value={String(productsForSale)} testId="products-for-sale" />
              <Figure label="Draft products" value={String(draftProducts)} testId="draft-products" />
            </dl>
          )}
        </LoadState>
      </div>
    </>
  );
}

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="panel p-6">
      <dt className="text-sm text-cocoa">{label}</dt>
      <dd className="mt-2 font-display text-5xl" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
