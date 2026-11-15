"use client";

import type { PricedLine } from "@luxebaddie/contracts";
import { MAX_QUANTITY_PER_LINE } from "@luxebaddie/contracts";
import Link from "next/link";
import { useState } from "react";
import { basketStore } from "@/cart/basket-store";
import { useBasket } from "@/cart/use-basket";
import { formatMoney } from "@/lib/money";

export function Bag() {
  const { basket, loading, saving, error } = useBasket();
  const [redirecting, setRedirecting] = useState(false);

  if (loading) return <p className="mt-10 text-cocoa">Loading your bag...</p>;

  const lines = basket?.lines ?? [];
  if (!basket || lines.length === 0) {
    return (
      <div className="mt-10">
        {error && <Notice>{error}</Notice>}
        <p className="text-lg text-cocoa">Your bag is empty.</p>
        <Link href="/shop" className="btn btn-primary mt-8">
          Start shopping
        </Link>
      </div>
    );
  }

  async function checkout() {
    setRedirecting(true);
    try {
      window.location.assign(await basketStore.checkout());
    } catch {
      setRedirecting(false); // the store holds the message shown below
    }
  }

  const toFreeShipping = basket.freeShippingThresholdCents - basket.subtotalCents;

  return (
    <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_20rem]">
      <div>
        {basket.removed.length > 0 && (
          <Notice>Some items are no longer available and were removed from your bag.</Notice>
        )}
        <ul className="divide-y divide-ink/15 border-y border-ink/15">
          {lines.map((line) => (
            <BagLine key={`${line.productId}#${line.sku}`} line={line} disabled={saving} />
          ))}
        </ul>
      </div>

      <aside className="h-fit bg-sand p-7">
        <h2 className="font-display text-2xl">Summary</h2>
        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd data-testid="subtotal">{formatMoney(basket.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Shipping</dt>
            <dd>{basket.shippingCents === 0 ? "Free" : formatMoney(basket.shippingCents)}</dd>
          </div>
          <div className="flex justify-between text-cocoa">
            <dt>Tax</dt>
            <dd>Calculated at checkout</dd>
          </div>
        </dl>
        {toFreeShipping > 0 && (
          <p className="mt-5 text-sm text-cocoa lg:text-xs">Add {formatMoney(toFreeShipping)} more for free shipping.</p>
        )}
        <button type="button" onClick={checkout} disabled={saving || redirecting} className="btn btn-primary mt-7 w-full">
          {redirecting ? "Opening checkout..." : "Checkout"}
        </button>
        {error && <p className="mt-4 text-sm text-wine">{error}</p>}
        <p className="mt-5 text-center text-xs text-cocoa">Secure payment by Stripe</p>
      </aside>
    </div>
  );
}

function BagLine({ line, disabled }: { line: PricedLine; disabled: boolean }) {
  const setQuantity = (quantity: number) => void basketStore.setQuantity(line, quantity).catch(() => {});

  return (
    <li className="flex gap-5 py-6">
      <div className="flex-1">
        <Link href={`/products/${line.productId}`} className="font-display text-xl hover:text-wine">
          {line.productName}
        </Link>
        {line.variantTitle && <p className="mt-1 text-sm text-cocoa">{line.variantTitle}</p>}
        <div className="mt-4 flex items-center gap-5">
          <div className="flex items-center border border-ink/25">
            <button
              type="button"
              aria-label={`Decrease quantity of ${line.productName}`}
              disabled={disabled}
              onClick={() => setQuantity(line.quantity - 1)}
              className="tap-target px-3 py-1.5 disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-8 text-center text-sm" aria-label="Quantity">
              {line.quantity}
            </span>
            <button
              type="button"
              aria-label={`Increase quantity of ${line.productName}`}
              disabled={disabled || line.quantity >= MAX_QUANTITY_PER_LINE}
              onClick={() => setQuantity(line.quantity + 1)}
              className="tap-target px-3 py-1.5 disabled:opacity-40"
            >
              +
            </button>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setQuantity(0)}
            className="link-underline tap-target text-xs tracking-[0.15em] text-cocoa uppercase"
          >
            Remove
          </button>
        </div>
      </div>
      <p className="text-right">{formatMoney(line.lineTotalCents)}</p>
    </li>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mb-6 border border-wine/30 bg-blush/50 px-4 py-3 text-sm text-wine">{children}</p>;
}
