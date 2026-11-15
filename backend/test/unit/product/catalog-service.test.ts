import { describe, expect, it } from "vitest";
import { createCatalogService } from "../../../src/product/application/catalog-service";
import { inMemoryProducts, recordingPhotoStore } from "../fakes";
import { lashes, owner, wig } from "../fixtures";

const draftWig = { ...wig, id: "draft-wig", status: "draft" as const };
const service = createCatalogService(inMemoryProducts(lashes, wig, draftWig), recordingPhotoStore());

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
    const catalog = createCatalogService(inMemoryProducts(wig), recordingPhotoStore());

    await catalog.addProduct(newWig, owner);

    expect(await catalog.getProduct("new-wig")).toEqual(newWig);
  });

  it("is refused when the address is taken, and leaves the product that has it untouched", async () => {
    const catalog = createCatalogService(inMemoryProducts(wig), recordingPhotoStore());

    await expect(catalog.addProduct({ ...newWig, id: wig.id }, owner)).rejects.toMatchObject({
      kind: "conflict",
      message: expect.stringContaining(`already a product at the address "${wig.id}"`),
    });
    expect(await catalog.getProduct(wig.id)).toEqual(wig);
  });

  it("is not what saving does: saving replaces the product with the same address", async () => {
    const catalog = createCatalogService(inMemoryProducts(wig), recordingPhotoStore());

    await catalog.saveProduct({ ...wig, name: "Renamed Wig" }, owner);

    expect((await catalog.getProduct(wig.id)).name).toBe("Renamed Wig");
  });
});

describe("uploading a product photo", () => {
  it("hands back where to send the file and the address the photo will have", async () => {
    const photos = recordingPhotoStore();
    const catalog = createCatalogService(inMemoryProducts(wig), photos);

    const upload = await catalog.startPhotoUpload("image/jpeg");

    expect(upload).toEqual({
      uploadUrl: "https://uploads.example",
      fields: { key: "photo-1" },
      photoUrl: "https://shop.example/media/products/photo-1",
    });
    expect(photos.started).toEqual(["image/jpeg"]);
  });

  it("changes no product: a photo only belongs to one once its address is saved there", async () => {
    const catalog = createCatalogService(inMemoryProducts(wig), recordingPhotoStore());

    await catalog.startPhotoUpload("image/png");

    expect(await catalog.getProduct(wig.id)).toEqual(wig);
  });
});

describe("the activity log of the catalog", () => {
  const AT = new Date("2026-11-15T09:30:00.000Z");
  const newWig = { ...wig, id: "new-wig", name: "New Wig", status: "draft" as const };
  const setUp = () => {
    const products = inMemoryProducts(wig);
    return { products, catalog: createCatalogService(products, recordingPhotoStore(), () => AT) };
  };

  it("records who added a product, when, and what it was called", async () => {
    const { products, catalog } = setUp();

    await catalog.addProduct(newWig, owner);

    expect(products.recorded).toEqual([
      {
        id: expect.any(String),
        at: AT.toISOString(),
        actor: owner,
        action: "product.added",
        subject: { kind: "product", id: "new-wig", label: "New Wig" },
        note: "Draft",
      },
    ]);
  });

  it("records a save, with whether the product is now for sale", async () => {
    const { products, catalog } = setUp();

    await catalog.saveProduct({ ...wig, status: "active" }, owner);

    expect(products.recorded).toEqual([expect.objectContaining({ action: "product.saved", note: "For sale" })]);
  });

  it("records a removal under the name the product had", async () => {
    const { products, catalog } = setUp();

    await catalog.removeProduct(wig.id, owner);

    expect(products.recorded).toEqual([
      expect.objectContaining({ action: "product.removed", subject: { kind: "product", id: wig.id, label: wig.name }, note: null }),
    ]);
    await expect(catalog.getProduct(wig.id)).rejects.toMatchObject({ kind: "not_found" });
  });

  it("records nothing for a change that did not happen", async () => {
    const { products, catalog } = setUp();

    await catalog.addProduct({ ...newWig, id: wig.id }, owner).catch(() => {});
    await catalog.removeProduct("never-existed", owner);

    expect(products.recorded).toEqual([]);
  });

  it("records an automation by the AWS identity it used", async () => {
    const { products, catalog } = setUp();
    const script = { kind: "automation", identity: "user/devAdmin" } as const;

    await catalog.saveProduct(wig, script);

    expect(products.recorded[0]?.actor).toEqual(script);
  });

  it("records nothing for reading, or for asking to upload a photo", async () => {
    const { products, catalog } = setUp();

    await catalog.listAllProducts();
    await catalog.getProduct(wig.id);
    await catalog.startPhotoUpload("image/jpeg");

    expect(products.recorded).toEqual([]);
  });
});
