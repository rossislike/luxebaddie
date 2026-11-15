"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { messageOf } from "./api";

type Outcome<T> = { status: "ready"; data: T } | { status: "failed"; message: string };

export type Loaded<T> = { status: "loading" } | (Outcome<T> & { reload: () => void });

/**
 * Loads something for a screen and says where the load stands. `load` must be
 * stable between renders (a module-level function, or wrapped in useCallback);
 * when it changes, or `reload` is called, the data is loaded again.
 */
export function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  // One object per load, so an answer can be matched to the load that asked for it.
  const request = useMemo(() => ({ load, attempt }), [load, attempt]);
  const [settled, setSettled] = useState<{ request: typeof request; outcome: Outcome<T> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settle = (outcome: Outcome<T>) => {
      if (!cancelled) setSettled({ request, outcome });
    };
    request.load().then(
      (data) => settle({ status: "ready", data }),
      (error) => settle({ status: "failed", message: messageOf(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [request]);

  // An answer to an earlier load says nothing about this one.
  if (settled?.request !== request) return { status: "loading" };
  return { ...settled.outcome, reload };
}
