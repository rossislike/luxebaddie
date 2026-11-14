/** In-memory stand-ins for the ports, so use cases can be tested without AWS or Stripe. */
import type { BasketItem, Order, Page, PricedBasket, Product } from "@luxebaddy/contracts";
import type { BasketRepository, Catalog, CheckoutGateway } from "../../src/basket/application/ports";
import type { OrderRepository, PageRequest } from "../../src/ordering/application/ports";
import type { EventPublisher, PaymentEvent } from "../../src/payment/application/ports";
import type { ProductRepository } from "../../src/product/application/ports";
import { productToItem } from "../../src/table/product-item";

/** Orders products the way the catalog collection does: by its GSI1 sort key. */
const inCatalogOrder = (a: Product, b: Product) =>
  String(productToItem(a).GSI1SK).localeCompare(String(productToItem(b).GSI1SK));

export function inMemoryProducts(...initial: Product[]): ProductRepository & Catalog {
  const products = new Map(initial.map((p) => [p.id, p]));
  const all = () => [...products.values()].sort(inCatalogOrder);
  return {
    findById: async (id) => products.get(id) ?? null,
    findForSale: async (category) =>
      all().filter((p) => p.status === "active" && (!category || p.category === category)),
    findAll: async () => all(),
    save: async (product) => void products.set(product.id, product),
    remove: async (id) => void products.delete(id),
    findProducts: async (ids) => new Map(ids.flatMap((id) => (products.has(id) ? [[id, products.get(id)!]] : []))),
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

export function recordingCheckout(): CheckoutGateway & { started: PricedBasket[] } {
  const started: PricedBasket[] = [];
  return {
    started,
    startCheckout: async (basket) => {
      started.push(basket);
      return `https://checkout.example/${basket.id}`;
    },
  };
}

export function recordingEvents(): EventPublisher & { published: PaymentEvent[] } {
  const published: PaymentEvent[] = [];
  return { published, publish: async (event) => void published.push(event) };
}

export function inMemoryOrders(): OrderRepository & { stored: Map<string, Order> } {
  const stored = new Map<string, Order>();

  /** Pages through a sorted list; the cursor is simply the next index. */
  const pageOf = (orders: Order[], { limit, cursor }: PageRequest): Page<Order> => {
    const start = cursor ? Number(cursor) : 0;
    const end = start + limit;
    return { items: orders.slice(start, end), nextCursor: end < orders.length ? String(end) : null };
  };

  return {
    stored,
    saveIfNew: async (order) => {
      if (stored.has(order.id)) return "already_exists";
      stored.set(order.id, order);
      return "created";
    },
    findById: async (id) => stored.get(id) ?? null,
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
