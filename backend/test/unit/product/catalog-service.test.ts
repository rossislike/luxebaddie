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
});
