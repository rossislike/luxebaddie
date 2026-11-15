"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { listCustomerOrders } from "@/orders/api";
import { OrderSearch } from "@/orders/order-search";
import { OrderTable } from "@/orders/order-table";
import { useOrderList } from "@/orders/use-order-list";

export default function CustomerPage() {
  return (
    // Whose orders to show comes from the address, which only the browser knows.
    <Suspense>
      <CustomerOrders />
    </Suspense>
  );
}

function CustomerOrders() {
  const email = useSearchParams().get("email") ?? "";

  return (
    <>
      <p className="eyebrow">
        <Link href="/orders">Orders</Link>
      </p>
      <h1 className="mt-2 font-display text-4xl break-words">{email || "No customer chosen"}</h1>
      <div className="mt-6">
        <OrderSearch />
      </div>
      {email && <OrdersOf email={email} />}
    </>
  );
}

function OrdersOf({ email }: { email: string }) {
  const list = useOrderList(useCallback((cursor: string | null) => listCustomerOrders(email, cursor), [email]));

  return (
    <>
      <p className="mt-8 mb-3 text-sm text-cocoa">This customer&apos;s orders, newest first.</p>
      <OrderTable list={list} emptyMessage="No orders were placed with this email address." showStatus />
    </>
  );
}
