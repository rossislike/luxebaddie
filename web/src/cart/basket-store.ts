import type { BasketItem, CheckoutResponse, PricedBasket } from "@luxebaddy/contracts";
import { ApiError, apiFetch } from "@/lib/api";

/**
 * The shopper's bag. The server owns the truth (items and prices live in the
 * basket service); this store mirrors it for the UI. Only an anonymous basket
 * id is kept in the browser.
 */
export type BasketState = {
  basket: PricedBasket | null;
  /** True until the first load finishes. */
  loading: boolean;
  /** A change is being saved. */
  saving: boolean;
  error: string | null;
};

const STORAGE_KEY = "luxebaddy.basketId";
const SERVER_STATE: BasketState = { basket: null, loading: true, saving: false, error: null };

let state: BasketState = SERVER_STATE;
let started = false;
const listeners = new Set<() => void>();
// Changes are applied one at a time so each builds on the previous result.
let queue: Promise<unknown> = Promise.resolve();

function setState(patch: Partial<BasketState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

let unsavedBasketId: string | undefined;

function basketId(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    const created = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // Storage blocked (private mode): the bag still works until the page is closed.
    return (unsavedBasketId ??= crypto.randomUUID());
  }
}

const itemsOf = (basket: PricedBasket | null): BasketItem[] =>
  (basket?.lines ?? []).map(({ productId, sku, quantity }) => ({ productId, sku, quantity }));

/** Our own 4xx messages are written for shoppers; anything else gets a generic apology. */
const messageOf = (error: unknown) =>
  error instanceof ApiError && error.status < 500
    ? error.message
    : "Something went wrong on our side. Please try again in a moment.";

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

async function load() {
  try {
    const basket = await apiFetch<PricedBasket>(`/basket/${basketId()}`);
    setState({ basket, loading: false, error: null });
  } catch (error) {
    setState({ loading: false, error: messageOf(error) });
  }
}

function mutate(change: (items: BasketItem[]) => BasketItem[]): Promise<void> {
  return enqueue(async () => {
    setState({ saving: true, error: null });
    try {
      const basket = await apiFetch<PricedBasket>(`/basket/${basketId()}`, {
        method: "PUT",
        json: { items: change(itemsOf(state.basket)) },
      });
      setState({ basket, saving: false });
    } catch (error) {
      setState({ saving: false, error: messageOf(error) });
      throw error;
    }
  });
}

const sameLine = (a: Pick<BasketItem, "productId" | "sku">, b: Pick<BasketItem, "productId" | "sku">) =>
  a.productId === b.productId && a.sku === b.sku;

export const basketStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (!started) {
      started = true;
      void enqueue(load);
    }
    return () => listeners.delete(listener);
  },
  getSnapshot: () => state,
  getServerSnapshot: () => SERVER_STATE,

  add(item: BasketItem) {
    return mutate((items) =>
      items.some((existing) => sameLine(existing, item))
        ? items.map((existing) =>
            sameLine(existing, item) ? { ...existing, quantity: existing.quantity + item.quantity } : existing,
          )
        : [...items, item],
    );
  },

  setQuantity(line: Pick<BasketItem, "productId" | "sku">, quantity: number) {
    return mutate((items) =>
      quantity <= 0
        ? items.filter((existing) => !sameLine(existing, line))
        : items.map((existing) => (sameLine(existing, line) ? { ...existing, quantity } : existing)),
    );
  },

  /** Starts Stripe Checkout and returns the URL to send the shopper to. */
  checkout(): Promise<string> {
    return enqueue(async () => {
      setState({ saving: true, error: null });
      try {
        const { url } = await apiFetch<CheckoutResponse>(`/basket/${basketId()}/checkout`, { method: "POST" });
        return url; // stay in the saving state while the browser navigates away
      } catch (error) {
        // A 409 carries the refreshed basket, e.g. after an item was discontinued.
        const refreshed = error instanceof ApiError && error.status === 409 ? (error.details as PricedBasket) : null;
        setState({ saving: false, error: messageOf(error), ...(refreshed && { basket: refreshed }) });
        throw error;
      }
    });
  },

  /** After a completed purchase: start a fresh, empty bag. */
  reset() {
    unsavedBasketId = undefined;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage blocked: clearing the in-memory id above is all there is to do.
    }
    setState({ basket: null, loading: false, saving: false, error: null });
  },
};
