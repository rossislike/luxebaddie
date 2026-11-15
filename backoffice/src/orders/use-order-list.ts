"use client";

import type { Order } from "@luxebaddie/contracts";
import { useCallback } from "react";
import { type PagedList, usePagedList } from "@/lib/use-paged-list";
import type { OrderPage } from "./api";

export type OrderList = PagedList<Order>;

/** A list of orders that grows a page at a time. `loadPage` must be stable between renders. */
export function useOrderList(loadPage: (cursor: string | null) => Promise<OrderPage>): OrderList {
  return usePagedList(
    useCallback(async (cursor: string | null) => {
      const page = await loadPage(cursor);
      return { items: page.orders, nextCursor: page.nextCursor };
    }, [loadPage]),
  );
}
