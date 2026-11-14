"use client";

import type { OrderConfirmation as Order } from "@luxebaddy/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { basketStore } from "@/cart/basket-store";
import { ApiError, apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";

// The order is written moments after payment, so give it a little time to appear.
const ATTEMPTS = 20;
const RETRY_MS = 1500;

type State = { status: "loading" } | { status: "found"; order: Order } | { status: "pending" };

export function OrderConfirmation() {
  const sessionId = useSearchParams().get("session_id");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    basketStore.reset(); // the purchase is done; the next visit starts a new bag

    (async () => {
      for (let attempt = 0; attempt < ATTEMPTS && !cancelled; attempt++) {
        try {
          const { order } = await apiFetch<{ order: Order }>(`/order/session/${encodeURIComponent(sessionId)}`);
          if (!cancelled) setState({ status: "found", order });
          return;
        } catch (error) {
          const notReadyYet = error instanceof ApiError && error.status === 404;
          if (!notReadyYet && attempt === ATTEMPTS - 1) break;
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
      }
      if (!cancelled) setState({ status: "pending" });
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <>
        <h1 className="font-display text-5xl">Nothing to show here</h1>
        <p className="mt-4 text-cocoa">This page confirms an order right after checkout.</p>
        <Link href="/shop" className="btn btn-primary mt-8">
          Back to the shop
        </Link>
      </>
    );
  }

  if (state.status === "loading") return <p className="text-cocoa">Confirming your order...</p>;

  if (state.status === "pending") {
    return (
      <>
        <h1 className="font-display text-5xl">Thank you!</h1>
        <p className="mt-4 text-cocoa">
          Your payment went through and we are still finalizing your order. Refresh this page in a minute to see your
          order number.
        </p>
      </>
    );
  }

  const { order } = state;
  const address = order.shippingAddress;

  return (
    <>
      <p className="eyebrow">Order confirmed</p>
      <h1 className="mt-4 font-display text-5xl sm:text-6xl">Thank you{order.shippingName ? `, ${order.shippingName.split(" ")[0]}` : ""}.</h1>
      <p className="mt-5 text-lg text-cocoa">
        Your order number is <strong className="text-ink" data-testid="order-number">{order.id}</strong>. Keep it handy
        in case you need to reach us about this order.
      </p>

      <ul className="mt-10 divide-y divide-ink/15 border-y border-ink/15">
        {order.items.map((item) => (
          <li key={item.sku} className="flex justify-between gap-6 py-4">
            <span>
              {item.description} <span className="text-cocoa">× {item.quantity}</span>
            </span>
            <span>{formatMoney(item.unitPriceCents * item.quantity)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-6 space-y-2 text-sm">
        <Row label="Subtotal" value={formatMoney(order.subtotalCents)} />
        {order.discountCents > 0 && <Row label="Discount" value={`-${formatMoney(order.discountCents)}`} />}
        <Row label="Shipping" value={order.shippingCents === 0 ? "Free" : formatMoney(order.shippingCents)} />
        {order.taxCents > 0 && <Row label="Tax" value={formatMoney(order.taxCents)} />}
        <div className="flex justify-between border-t border-ink/15 pt-3 text-base font-medium">
          <dt>Total</dt>
          <dd data-testid="order-total">{formatMoney(order.totalCents)}</dd>
        </div>
      </dl>

      {address && (
        <div className="mt-10">
          <h2 className="text-xs tracking-[0.2em] uppercase">Shipping to</h2>
          <address className="mt-3 text-cocoa not-italic">
            {order.shippingName}
            <br />
            {address.line1}
            {address.line2 && `, ${address.line2}`}
            <br />
            {address.city}, {address.state} {address.postalCode}
          </address>
        </div>
      )}

      <Link href="/shop" className="btn btn-outline mt-12">
        Keep shopping
      </Link>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
