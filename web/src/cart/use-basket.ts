"use client";

import { useSyncExternalStore } from "react";
import { basketStore } from "./basket-store";

export function useBasket() {
  const state = useSyncExternalStore(basketStore.subscribe, basketStore.getSnapshot, basketStore.getServerSnapshot);
  const itemCount = (state.basket?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
  return { ...state, itemCount };
}
