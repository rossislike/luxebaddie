import { describe, expect, it } from "vitest";
import { createCatalogService } from "../../../src/product/application/catalog-service";
import { inMemoryProducts } from "../fakes";
import { lashes, wig } from "../fixtures";

const draftWig = { ...wig, id: "draft-wig", status: "draft" as const };
const service = createCatalogService(inMemoryProducts(lashes, wig, draftWig));

describe("the storefront's view of the catalog", () => {
  it("lists only products for sale", async () => {
    expect((await service.listProductsForSale()).map((p) => p.id).sort()).toEqual(["test-lashes", "test-wig"]);
  });

  it("filters by category", async () => {
    expect((await service.listProductsForSale("lashes")).map((p) => p.id)).toEqual(["test-lashes"]);
  });

  it("treats drafts and unknown products as not found", async () => {
    expect(await service.getProductForSale("test-wig")).toEqual(wig);
    await expect(service.getProductForSale("draft-wig")).rejects.toMatchObject({ kind: "not_found" });
    await expect(service.getProductForSale("ghost")).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("the admin's view of the catalog", () => {
  it("includes drafts", async () => {
    expect((await service.listAllProducts()).map((p) => p.id)).toContain("draft-wig");
  });

  it("opens any product, draft or for sale", async () => {
    expect(await service.getProduct("draft-wig")).toEqual(draftWig);
    expect(await service.getProduct("test-wig")).toEqual(wig);
    await expect(service.getProduct("ghost")).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("adding a product", () => {
  const newWig = { ...wig, id: "new-wig", name: "New Wig" };

  it("puts it in the catalog", async () => {
    const catalog = createCatalogService(inMemoryProducts(wig));

    await catalog.addProduct(newWig);

    expect(await catalog.getProduct("new-wig")).toEqual(newWig);
  });

  it("is refused when the address is taken, and leaves the product that has it untouched", async () => {
    const catalog = createCatalogService(inMemoryProducts(wig));

    await expect(catalog.addProduct({ ...newWig, id: wig.id })).rejects.toMatchObject({
      kind: "conflict",
      message: expect.stringContaining(`already a product at the address "${wig.id}"`),
    });
    expect(await catalog.getProduct(wig.id)).toEqual(wig);
  });

  it("is not what saving does: saving replaces the product with the same address", async () => {
    const catalog = createCatalogService(inMemoryProducts(wig));

    await catalog.saveProduct({ ...wig, name: "Renamed Wig" });

    expect((await catalog.getProduct(wig.id)).name).toBe("Renamed Wig");
  });
});
