"use client";

import type { Order } from "@luxebaddie/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { messageOf } from "@/lib/api";
import type { OrderPage } from "./api";

export type OrderList = {
  orders: Order[];
  /** True until the first page has arrived. */
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
};

type Progress = { orders: Order[]; nextCursor: string | null; loaded: boolean; error: string | null; fetching: boolean };

const NOT_STARTED: Progress = { orders: [], nextCursor: null, loaded: false, error: null, fetching: true };

/**
 * A list of orders that grows a page at a time. `loadPage` must be stable
 * between renders (wrap it in useCallback); when it changes, the list starts over.
 */
export function useOrderList(loadPage: (cursor: string | null) => Promise<OrderPage>): OrderList {
  // One object per list, so a page can be matched to the list that asked for it.
  const list = useMemo(() => ({ loadPage }), [loadPage]);
  const [progress, setProgress] = useState<{ list: typeof list; progress: Progress }>({ list, progress: NOT_STARTED });
  const current = progress.list === list ? progress.progress : NOT_STARTED;

  const fetchPage = useCallback(
    (cursor: string | null, before: Order[]) => {
      list.loadPage(cursor).then(
        (page) =>
          setProgress({
            list,
            progress: { orders: [...before, ...page.orders], nextCursor: page.nextCursor, loaded: true, error: null, fetching: false },
          }),
        (error) =>
          setProgress({ list, progress: { orders: before, nextCursor: cursor, loaded: true, error: messageOf(error), fetching: false } }),
      );
    },
    [list],
  );

  useEffect(() => fetchPage(null, []), [fetchPage]);

  return {
    orders: current.orders,
    loading: !current.loaded,
    loadingMore: current.loaded && current.fetching,
    hasMore: current.nextCursor !== null,
    error: current.error,
    loadMore: () => {
      setProgress({ list, progress: { ...current, fetching: true, error: null } });
      fetchPage(current.nextCursor, current.orders);
    },
  };
}
