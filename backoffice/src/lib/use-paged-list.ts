"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { messageOf } from "./api";

export type PagedList<T> = {
  items: T[];
  /** True until the first page has arrived. */
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
};

type Progress<T> = { items: T[]; nextCursor: string | null; loaded: boolean; error: string | null; fetching: boolean };

/**
 * A list that grows a page at a time. `loadPage` must be stable between
 * renders (wrap it in useCallback); when it changes, the list starts over.
 */
export function usePagedList<T>(loadPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>): PagedList<T> {
  // One object per list, so a page can be matched to the list that asked for it.
  const list = useMemo(() => ({ loadPage }), [loadPage]);
  const [state, setState] = useState<{ list: typeof list; progress: Progress<T> } | null>(null);
  const current: Progress<T> =
    state?.list === list ? state.progress : { items: [], nextCursor: null, loaded: false, error: null, fetching: true };

  const fetchPage = useCallback(
    (cursor: string | null, before: T[]) => {
      list.loadPage(cursor).then(
        (page) =>
          setState({ list, progress: { items: [...before, ...page.items], nextCursor: page.nextCursor, loaded: true, error: null, fetching: false } }),
        (error) => setState({ list, progress: { items: before, nextCursor: cursor, loaded: true, error: messageOf(error), fetching: false } }),
      );
    },
    [list],
  );

  useEffect(() => fetchPage(null, []), [fetchPage]);

  return {
    items: current.items,
    loading: !current.loaded,
    loadingMore: current.loaded && current.fetching,
    hasMore: current.nextCursor !== null,
    error: current.error,
    loadMore: () => {
      setState({ list, progress: { ...current, fetching: true, error: null } });
      fetchPage(current.nextCursor, current.items);
    },
  };
}
