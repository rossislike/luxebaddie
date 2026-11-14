"use client";

import type { Product } from "@luxebaddy/contracts";
import Link from "next/link";
import { useState } from "react";
import { basketStore } from "@/cart/basket-store";
import { defaultSelection, findVariant, isSelectable, optionValues, select } from "@/catalog/variant-selection";
import { formatMoney } from "@/lib/money";

export function AddToBag({ product }: { product: Product }) {
  const [selection, setSelection] = useState(() => defaultSelection(product));
  const [status, setStatus] = useState<"idle" | "adding" | "added" | "error">("idle");
  const variant = findVariant(product, selection);
  const values = optionValues(product);

  async function add() {
    if (!variant) return;
    setStatus("adding");
    try {
      await basketStore.add({ productId: product.id, sku: variant.sku, quantity: 1 });
      setStatus("added");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mt-8">
      <p className="flex items-baseline gap-3 text-2xl" data-testid="price">
        {variant ? formatMoney(variant.priceCents) : "Unavailable"}
        {variant?.compareAtCents && variant.compareAtCents > variant.priceCents && (
          <s className="text-base text-cocoa">{formatMoney(variant.compareAtCents)}</s>
        )}
      </p>

      {product.optionNames.map((name) => (
        <fieldset key={name} className="mt-7">
          <legend className="text-xs tracking-[0.2em] uppercase">
            {name}: <span className="text-cocoa">{selection[name]}</span>
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {values[name]?.map((value) => {
              const selected = selection[name] === value;
              const selectable = isSelectable(product, selection, name, value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setSelection(select(product, selection, name, value));
                    setStatus("idle");
                  }}
                  className={`min-w-14 border px-4 py-2.5 text-sm transition-colors ${
                    selected
                      ? "border-ink bg-ink text-cream"
                      : `border-ink/25 hover:border-ink ${selectable ? "" : "text-ink/40"}`
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <button type="button" onClick={add} disabled={!variant || status === "adding"} className="btn btn-primary mt-9 w-full">
        {status === "adding" ? "Adding..." : "Add to bag"}
      </button>

      <p className="mt-4 min-h-6 text-sm" role="status">
        {status === "added" && (
          <>
            Added to your bag.{" "}
            <Link href="/bag" className="link-underline font-medium text-wine">
              View bag
            </Link>
          </>
        )}
        {status === "error" && <span className="text-wine">We could not add that to your bag. Please try again.</span>}
      </p>
    </div>
  );
}
