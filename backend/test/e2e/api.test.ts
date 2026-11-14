/**
 * End-to-end tests against the deployed dev stage: real API Gateway, Lambdas,
 * DynamoDB, EventBridge and SQS. Needs AWS credentials for the account.
 *
 *   pnpm test:e2e
 *
 * Paying on Stripe's hosted page is the one step these tests do not drive;
 * instead they publish the CheckoutCompleted event the payment service emits
 * after a real payment.
 */
import { randomUUID } from "node:crypto";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
  type CheckoutCompleted,
  EVENTS,
  type Order,
  type OrderConfirmation,
  type PricedBasket,
  type Product,
} from "@luxebaddie/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { secretParameterNames } from "../../lib/stage-config";
import { createAdminFetch, getStackOutputs, type StackOutputs } from "../../scripts/lib/aws";
import { createDocumentClient } from "../../src/shared/adapters/aws-clients";
import { orderKey } from "../../src/table/order-item";

const STAGE = "dev";
const run = randomUUID().slice(0, 8);

const product: Product = {
  id: `e2e-wig-${run}`,
  name: "E2E Wig",
  category: "wigs",
  tagline: "Created by an automated test",
  description: "Safe to delete.",
  highlights: [],
  optionNames: ["Length"],
  images: [],
  status: "active",
  featured: false,
  position: 9999,
  variants: [
    { sku: `E2E-${run.toUpperCase()}-16`, options: { Length: '16"' }, priceCents: 10_000, active: true },
    { sku: `E2E-${run.toUpperCase()}-20`, options: { Length: '20"' }, priceCents: 14_000, active: false },
  ],
};
const [activeVariant, inactiveVariant] = product.variants as [Product["variants"][0], Product["variants"][0]];

let outputs: StackOutputs;
let adminFetch: typeof fetch;
const createdOrderIds: string[] = [];
const ddb = createDocumentClient();

const api = (path: string) => `${outputs.ApiUrl}${path}`;
const productsIn = async (path: string) => ((await (await fetch(api(path))).json()) as { products: Product[] }).products;
const idsIn = async (path: string) => (await productsIn(path)).map((p) => p.id);
const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function eventually<T>(read: () => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the expected state");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

beforeAll(async () => {
  outputs = await getStackOutputs(STAGE);
  adminFetch = await createAdminFetch();
});

afterAll(async () => {
  await adminFetch(api(`/admin/product/${product.id}`), { method: "DELETE" });
  for (const id of createdOrderIds) {
    await ddb.send(new DeleteCommand({ TableName: outputs.TableName, Key: orderKey(id) }));
  }
});

describe("catalog", () => {
  it("rejects unsigned calls to admin routes", async () => {
    const response = await fetch(api(`/admin/product/${product.id}`), { method: "PUT", ...json(product) });
    expect(response.status).toBe(403);
  });

  it("rejects an invalid product", async () => {
    const response = await adminFetch(api(`/admin/product/${product.id}`), {
      method: "PUT",
      ...json({ ...product, variants: [] }),
    });
    expect(response.status).toBe(400);
  });

  it("publishes a product through the admin API and serves it publicly", async () => {
    const put = await adminFetch(api(`/admin/product/${product.id}`), { method: "PUT", ...json(product) });
    expect(put.status).toBe(200);

    const single = await fetch(api(`/product/${product.id}`));
    expect(single.status).toBe(200);
    expect(((await single.json()) as { product: Product }).product).toEqual(product);

  });

  it("lists the product in its own category only", async () => {
    // Catalog listings come from an index, which catches up a moment after a write.
    await eventually(async () => ((await idsIn("/product?category=wigs")).includes(product.id) ? true : null));

    expect(await idsIn("/product")).toContain(product.id);
    expect(await idsIn("/product?category=lashes")).not.toContain(product.id);
  });

  it("returns each category in position order", async () => {
    const wigs = await productsIn("/product?category=wigs");
    const positions = wigs.map((p) => p.position);

    expect(wigs.every((p) => p.category === "wigs" && p.status === "active")).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("hides draft products from the storefront but not from admin", async () => {
    const draftId = `e2e-draft-${run}`;
    const draft: Product = { ...product, id: draftId, status: "draft", variants: [{ ...activeVariant, sku: `E2E-${run.toUpperCase()}-DRAFT` }] };
    try {
      expect((await adminFetch(api(`/admin/product/${draftId}`), { method: "PUT", ...json(draft) })).status).toBe(200);
      expect((await fetch(api(`/product/${draftId}`))).status).toBe(404);

      await eventually(async () => {
        const adminList = await adminFetch(api("/admin/product"));
        const { products } = (await adminList.json()) as { products: Product[] };
        return products.some((p) => p.id === draftId) ? true : null;
      });
      expect(await idsIn("/product")).not.toContain(draftId);
    } finally {
      await adminFetch(api(`/admin/product/${draftId}`), { method: "DELETE" });
    }
  });

  it("answers CORS preflight for the storefront origin", async () => {
    const response = await fetch(api("/basket/x"), {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "PUT" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});

describe("basket", () => {
  const basketId = randomUUID();

  it("prices the basket from the catalog and drops items that are not for sale", async () => {
    const response = await fetch(api(`/basket/${basketId}`), {
      method: "PUT",
      ...json({
        items: [
          { productId: product.id, sku: activeVariant.sku, quantity: 2 },
          { productId: product.id, sku: inactiveVariant.sku, quantity: 1 },
          { productId: "does-not-exist", sku: "NOPE", quantity: 1 },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const basket = (await response.json()) as PricedBasket;

    expect(basket.lines).toEqual([
      expect.objectContaining({ sku: activeVariant.sku, quantity: 2, unitPriceCents: 10_000, lineTotalCents: 20_000, variantTitle: '16"' }),
    ]);
    expect(basket.subtotalCents).toBe(20_000);
    expect(basket.shippingCents).toBe(0);
    expect(basket.removed).toHaveLength(2);
  });

  it("remembers the basket", async () => {
    const basket = (await (await fetch(api(`/basket/${basketId}`))).json()) as PricedBasket;
    expect(basket.lines).toHaveLength(1);
    expect(basket.removed).toEqual([]);
  });

  it("rejects malformed requests", async () => {
    expect((await fetch(api("/basket/not-a-uuid"))).status).toBe(400);
    const tooMany = await fetch(api(`/basket/${basketId}`), {
      method: "PUT",
      ...json({ items: [{ productId: product.id, sku: activeVariant.sku, quantity: 999 }] }),
    });
    expect(tooMany.status).toBe(400);
  });

  it("refuses to check out an empty basket", async () => {
    const response = await fetch(api(`/basket/${randomUUID()}/checkout`), { method: "POST" });
    expect(response.status).toBe(409);
  });

  it("deletes the basket", async () => {
    expect((await fetch(api(`/basket/${basketId}`), { method: "DELETE" })).status).toBe(204);
    const basket = (await (await fetch(api(`/basket/${basketId}`))).json()) as PricedBasket;
    expect(basket.lines).toEqual([]);
  });
});

describe("checkout to order", () => {
  it("refuses webhook calls that do not come from Stripe's addresses", async () => {
    const fromHere = await fetch(api("/payment/webhook"), { method: "POST", ...json({ type: "checkout.session.completed" }) });
    expect(fromHere.status).toBe(403);
  });

  it("starts a Stripe Checkout session for a basket", async (context) => {
    const stripeConfigured = await new SSMClient({})
      .send(new GetParameterCommand({ Name: secretParameterNames(STAGE).basketStripeKey }))
      .then(() => true)
      .catch(() => false);
    if (!stripeConfigured) return context.skip("Stripe is not connected to this stage yet (pnpm stripe:setup:dev)");

    const basketId = randomUUID();
    await fetch(api(`/basket/${basketId}`), {
      method: "PUT",
      ...json({ items: [{ productId: product.id, sku: activeVariant.sku, quantity: 1 }] }),
    });
    const response = await fetch(api(`/basket/${basketId}/checkout`), { method: "POST" });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { url: string }).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    await fetch(api(`/basket/${basketId}`), { method: "DELETE" });
  });

  describe("when the payment service announces a paid checkout", () => {
    const basketId = randomUUID();
    const checkoutSessionId = `cs_test_e2e_${randomUUID()}`;
    const customerEmail = `e2e-${run}@example.com`;
    const checkout: CheckoutCompleted = {
      checkoutSessionId,
      paymentIntentId: "pi_e2e",
      basketId,
      email: customerEmail,
      customerName: "E2E Shopper",
      phone: null,
      shippingName: "E2E Shopper",
      shippingAddress: { line1: "1 Test St", line2: null, city: "Atlanta", state: "GA", postalCode: "30301", country: "US" },
      items: [{ productId: product.id, sku: activeVariant.sku, description: 'E2E Wig - 16"', unitPriceCents: 10_000, quantity: 1 }],
      subtotalCents: 10_000,
      discountCents: 0,
      shippingCents: 795,
      taxCents: 0,
      totalCents: 10_795,
      currency: "usd",
      paidAt: new Date().toISOString(),
    };
    let confirmation: OrderConfirmation;

    const publish = (detail: CheckoutCompleted) =>
      new EventBridgeClient({}).send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: outputs.EventBusName,
              Source: EVENTS.checkoutCompleted.source,
              DetailType: EVENTS.checkoutCompleted.detailType,
              Detail: JSON.stringify(detail),
            },
          ],
        }),
      );
    const publishCheckoutCompleted = () => publish(checkout);

    type OrderList = { orders: Order[]; nextCursor: string | null };
    const adminGet = async <T>(path: string) => (await (await adminFetch(api(path))).json()) as T;
    const fetchOrder = async () => (await adminGet<{ order: Order }>(`/admin/order/${confirmation.id}`)).order;
    const customerOrders = (query = "") =>
      adminGet<OrderList>(`/admin/customer/${encodeURIComponent(customerEmail)}/order${query}`);

    /** Walks every page of the unfulfilled queue. */
    async function fetchUnfulfilled(): Promise<Order[]> {
      const orders: Order[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const page: OrderList = await adminGet<OrderList>(`/admin/order?fulfillmentStatus=unfulfilled&limit=100${query}`);
        orders.push(...page.orders);
        cursor = page.nextCursor;
      } while (cursor);
      return orders;
    }

    beforeAll(async () => {
      await fetch(api(`/basket/${basketId}`), {
        method: "PUT",
        ...json({ items: [{ productId: product.id, sku: activeVariant.sku, quantity: 1 }] }),
      });
    });

    it("has no order before the payment", async () => {
      expect((await fetch(api(`/order/session/${checkoutSessionId}`))).status).toBe(404);
    });

    it("creates the order and shows it on the confirmation page", async () => {
      await publishCheckoutCompleted();

      // EventBridge -> order queue -> ordering Lambda -> DynamoDB
      confirmation = await eventually(async () => {
        const response = await fetch(api(`/order/session/${checkoutSessionId}`));
        return response.ok ? ((await response.json()) as { order: OrderConfirmation }).order : null;
      });
      createdOrderIds.push(confirmation.id);

      expect(confirmation.id).toMatch(/^LB-[0-9A-Z]{10}$/);
      expect(confirmation).toMatchObject({ email: customerEmail, totalCents: 10_795, items: checkout.items });
      expect(confirmation).not.toHaveProperty("paymentIntentId");
    });

    it("empties the basket that was paid for", async () => {
      // EventBridge -> paid-basket queue -> basket Lambda
      await eventually(async () => {
        const basket = (await (await fetch(api(`/basket/${basketId}`))).json()) as PricedBasket;
        return basket.lines.length === 0 ? true : null;
      });
    });

    it("lists the order for fulfillment, to admins only", async () => {
      expect((await fetch(api(`/admin/order/${confirmation.id}`))).status).toBe(403);
      // The queue is an index, which catches up a moment after the order is written.
      await eventually(async () => ((await fetchUnfulfilled()).some((o) => o.id === confirmation.id) ? true : null));
    });

    it("finds the customer's orders by email, whatever its capitalisation", async () => {
      const shouting = encodeURIComponent(customerEmail.toUpperCase());
      const found = await eventually(async () => {
        const { orders } = await adminGet<OrderList>(`/admin/customer/${shouting}/order`);
        return orders.length > 0 ? orders : null;
      });

      expect(found.map((order) => order.id)).toEqual([confirmation.id]);
      expect((await fetch(api(`/admin/customer/${shouting}/order`))).status).toBe(403);
    });

    it("pages through a customer's orders newest first", async () => {
      const later = { ...checkout, checkoutSessionId: `cs_test_e2e_${randomUUID()}`, basketId: null, paidAt: new Date(Date.now() + 60_000).toISOString() };
      await publish(later);
      await eventually(async () => ((await customerOrders()).orders.length === 2 ? true : null));

      const firstPage = await customerOrders("?limit=1");
      createdOrderIds.push(firstPage.orders[0]!.id);
      expect(firstPage.orders.map((order) => order.checkoutSessionId)).toEqual([later.checkoutSessionId]);
      expect(firstPage.nextCursor).not.toBeNull();

      const secondPage = await customerOrders(`?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`);
      expect(secondPage.orders.map((order) => order.id)).toEqual([confirmation.id]);

      const lastPage = await customerOrders(`?limit=1&cursor=${encodeURIComponent(secondPage.nextCursor ?? "")}`);
      expect(secondPage.nextCursor === null || lastPage.orders.length === 0).toBe(true);
    });

    it("rejects a cursor it did not issue and an out-of-range page size", async () => {
      const badCursor = await adminFetch(api(`/admin/order?cursor=not-a-cursor`));
      const badLimit = await adminFetch(api(`/admin/order?limit=1000`));
      expect([badCursor.status, badLimit.status]).toEqual([400, 400]);
    });

    it("does not create a second order when the same event is delivered again", async () => {
      const original = await fetchOrder();

      await publishCheckoutCompleted();
      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(await fetchOrder()).toEqual(original);
      const forThisCheckout = (await fetchUnfulfilled()).filter((order) => order.checkoutSessionId === checkoutSessionId);
      expect(forThisCheckout).toHaveLength(1);
    });
  });
});
