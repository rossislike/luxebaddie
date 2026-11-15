"use client";

import Link from "next/link";
import { useBasket } from "@/cart/use-basket";

export function BagLink() {
  const { itemCount } = useBasket();
  return (
    <Link href="/bag" className="link-underline tap-target text-xs tracking-[0.1em] whitespace-nowrap uppercase xs:tracking-[0.15em] sm:text-sm" aria-label={`Bag, ${itemCount} ${itemCount === 1 ? "item" : "items"}`}>
      Bag <span data-testid="bag-count">({itemCount})</span>
    </Link>
  );
}
