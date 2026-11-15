"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { searchPage, searchTarget } from "./search";

/** Finds an order by its number, or a customer's orders by their email address. */
export function OrderSearch() {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [notUnderstood, setNotUnderstood] = useState(false);

  function search(event: FormEvent) {
    event.preventDefault();
    const target = searchTarget(typed);
    setNotUnderstood(!target);
    if (target) router.push(searchPage(target));
  }

  return (
    <form onSubmit={search} role="search" className="max-w-xl">
      <label htmlFor="order-search" className="text-sm text-cocoa">
        Find an order by its number, or a customer by email
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="order-search"
          className="field"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="LB-7K3M9Q2XAB or name@example.com"
          autoComplete="off"
          aria-describedby={notUnderstood ? "order-search-help" : undefined}
        />
        <button type="submit" className="btn btn-primary">
          Find
        </button>
      </div>
      {notUnderstood && (
        <p id="order-search-help" role="alert" className="mt-2 text-sm text-wine">
          Type a full order number, like LB-7K3M9Q2XAB, or a full email address.
        </p>
      )}
    </form>
  );
}
