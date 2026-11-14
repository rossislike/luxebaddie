import { beforeEach, describe, expect, it } from "vitest";
import { createBasketService } from "../../../src/basket/application/basket-service";
import { AppError } from "../../../src/shared/errors";
import { inMemoryBaskets, inMemoryProducts, recordingCheckout } from "../fakes";
import { BASKET_ID, lashes, wig } from "../fixtures";

const wigLine = { productId: "test-wig", sku: "TW-16", quantity: 1 };
const discontinuedLine = { productId: "test-wig", sku: "TW-24", quantity: 1 };

let baskets: ReturnType<typeof inMemoryBaskets>;
let checkout: ReturnType<typeof recordingCheckout>;
let service: ReturnType<typeof createBasketService>;

beforeEach(() => {
  baskets = inMemoryBaskets();
  checkout = recordingCheckout();
  service = createBasketService({ baskets, catalog: inMemoryProducts(wig, lashes), checkout });
});

describe("viewing and editing a basket", () => {
  it("shows an unknown basket as empty", async () => {
    expect(await service.viewBasket(BASKET_ID)).toMatchObject({ lines: [], subtotalCents: 0 });
  });

  it("saves only the items that are for sale and reports the rest", async () => {
    const basket = await service.replaceItems(BASKET_ID, [wigLine, discontinuedLine]);

    expect(basket.removed).toEqual([discontinuedLine]);
    expect(baskets.saved.get(BASKET_ID)).toEqual([wigLine]);
  });

  it("forgets a basket that was emptied or discarded", async () => {
    await service.replaceItems(BASKET_ID, [wigLine]);
    await service.replaceItems(BASKET_ID, []);
    expect(baskets.saved.has(BASKET_ID)).toBe(false);

    await service.replaceItems(BASKET_ID, [wigLine]);
    await service.discardBasket(BASKET_ID);
    expect(baskets.saved.has(BASKET_ID)).toBe(false);
  });
});

describe("starting checkout", () => {
  it("sends the priced basket to the checkout gateway and returns its URL", async () => {
    await service.replaceItems(BASKET_ID, [wigLine]);

    const url = await service.startCheckout(BASKET_ID);

    expect(url).toBe(`https://checkout.example/${BASKET_ID}`);
    expect(checkout.started).toEqual([expect.objectContaining({ id: BASKET_ID, subtotalCents: 10_000 })]);
  });

  it("passes on which storefront the shopper should return to", async () => {
    await service.replaceItems(BASKET_ID, [wigLine]);

    await service.startCheckout(BASKET_ID, "http://localhost:3000");

    expect(checkout.returnTo).toEqual(["http://localhost:3000"]);
  });

  it("refuses an empty basket", async () => {
    await expect(service.startCheckout(BASKET_ID)).rejects.toMatchObject({ kind: "conflict" });
    expect(checkout.started).toEqual([]);
  });

  it("refuses, and cleans the basket, when an item was discontinued since it was added", async () => {
    baskets.saved.set(BASKET_ID, [wigLine, discontinuedLine]);

    const error = await service.startCheckout(BASKET_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ kind: "conflict", details: { removed: [discontinuedLine] } });
    expect(checkout.started).toEqual([]);
    expect(baskets.saved.get(BASKET_ID)).toEqual([wigLine]);
  });
});
