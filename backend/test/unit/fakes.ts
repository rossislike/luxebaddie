/** In-memory stand-ins for the ports, so use cases can be tested without AWS or Stripe. */
import type { Activity, BasketItem, Order, Page, PricedBasket, Product } from "@luxebaddie/contracts";
import type { BasketRepository, Catalog, CheckoutGateway } from "../../src/basket/application/ports";
import type { OrderRepository, PageRequest } from "../../src/ordering/application/ports";
import type { EventPublisher, PaymentEvent } from "../../src/payment/application/ports";
import type { PhotoStore, ProductRepository } from "../../src/product/application/ports";
import { productToItem } from "../../src/table/product-item";

/** Orders products the way the catalog collection does: by its GSI1 sort key. */
const inCatalogOrder = (a: Product, b: Product) =>
  String(productToItem(a).GSI1SK).localeCompare(String(productToItem(b).GSI1SK));

/** `recorded` is the activity log as these fakes wrote it: an entry only for a change that was stored. */
type Recording = { recorded: Activity[] };

export function inMemoryProducts(...initial: Product[]): ProductRepository & Catalog & Recording {
  const products = new Map(initial.map((p) => [p.id, p]));
  const recorded: Activity[] = [];
  const all = () => [...products.values()].sort(inCatalogOrder);
  return {
    recorded,
    findById: async (id) => products.get(id) ?? null,
    findForSale: async (category) =>
      all().filter((p) => p.status === "active" && (!category || p.category === category)),
    findAll: async () => all(),
    save: async (product, activity) => {
      products.set(product.id, product);
      recorded.push(activity);
    },
    saveNew: async (product, activity) => {
      if (products.has(product.id)) return "already_exists";
      products.set(product.id, product);
      recorded.push(activity);
      return "created";
    },
    remove: async (id, activity) => {
      if (!products.delete(id)) return "not_found";
      recorded.push(activity);
      return "removed";
    },
    findProducts: async (ids) => new Map(ids.flatMap((id) => (products.has(id) ? [[id, products.get(id)!]] : []))),
  };
}

/** Hands out upload permissions for made-up addresses and remembers what was asked for. */
export function recordingPhotoStore(): PhotoStore & { started: string[] } {
  const started: string[] = [];
  return {
    started,
    startUpload: async (contentType) => {
      started.push(contentType);
      const name = `photo-${started.length}`;
      return { uploadUrl: "https://uploads.example", fields: { key: name }, photoUrl: `https://shop.example/media/products/${name}` };
    },
  };
}

export function inMemoryBaskets(): BasketRepository & { saved: Map<string, BasketItem[]> } {
  const saved = new Map<string, BasketItem[]>();
  return {
    saved,
    findItems: async (id) => saved.get(id) ?? [],
    saveItems: async (id, items) => void (items.length > 0 ? saved.set(id, items) : saved.delete(id)),
    remove: async (id) => void saved.delete(id),
  };
}

export function recordingCheckout(): CheckoutGateway & { started: PricedBasket[]; returnTo: (string | undefined)[] } {
  const started: PricedBasket[] = [];
  const returnTo: (string | undefined)[] = [];
  return {
    started,
    returnTo,
    startCheckout: async (basket, storefront) => {
      started.push(basket);
      returnTo.push(storefront);
      return `https://checkout.example/${basket.id}`;
    },
  };
}

export function recordingEvents(): EventPublisher & { published: PaymentEvent[] } {
  const published: PaymentEvent[] = [];
  return { published, publish: async (event) => void published.push(event) };
}

export function inMemoryOrders(): OrderRepository & { stored: Map<string, Order> } & Recording {
  const stored = new Map<string, Order>();
  const recorded: Activity[] = [];

  /** Pages through a sorted list; the cursor is simply the next index. */
  const pageOf = (orders: Order[], { limit, cursor }: PageRequest): Page<Order> => {
    const start = cursor ? Number(cursor) : 0;
    const end = start + limit;
    return { items: orders.slice(start, end), nextCursor: end < orders.length ? String(end) : null };
  };

  return {
    stored,
    recorded,
    saveIfNew: async (order) => {
      if (stored.has(order.id)) return "already_exists";
      stored.set(order.id, order);
      return "created";
    },
    findById: async (id) => stored.get(id) ?? null,
    saveFulfillment: async (order, from, activity) => {
      if (stored.get(order.id)?.fulfillmentStatus !== from) return "changed_meanwhile";
      stored.set(order.id, order);
      recorded.push(activity);
      return "saved";
    },
    findByFulfillmentStatus: async (status, page) =>
      pageOf(
        [...stored.values()]
          .filter((order) => order.fulfillmentStatus === status)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        page,
      ),
    findByCustomerEmail: async (email, page) =>
      pageOf(
        [...stored.values()]
          .filter((order) => order.email?.toLowerCase() === email.toLowerCase())
          .sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
        page,
      ),
  };
}
