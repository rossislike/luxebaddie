import type { ActivityAction, Actor, CategorySlug, PhotoContentType, Product } from "@luxebaddie/contracts";
import { activityFor } from "../../shared/activity";
import { conflict, notFound } from "../../shared/errors";
import type { PhotoStore, ProductRepository } from "./ports";

/**
 * Catalog use cases. Shoppers only ever see products for sale; admins see
 * everything. Every change says who is making it, and is recorded in the
 * activity log as part of being made.
 */
export function createCatalogService(products: ProductRepository, photos: PhotoStore, now: () => Date = () => new Date()) {
  const recordOf = (action: ActivityAction, product: Product, actor: Actor) =>
    activityFor(
      {
        actor,
        action,
        subject: { kind: "product", id: product.id, label: product.name },
        note: action === "product.removed" ? null : product.status === "active" ? "For sale" : "Draft",
      },
      now(),
    );

  return {
    /**
     * Lets the back office upload one product photo. The photo is not part of
     * any product until its address is saved into that product's images.
     */
    startPhotoUpload: (contentType: PhotoContentType) => photos.startUpload(contentType),

    listProductsForSale: (category?: CategorySlug) => products.findForSale(category),

    async getProductForSale(id: string): Promise<Product> {
      const product = await products.findById(id);
      if (!product || product.status !== "active") throw notFound("Product");
      return product;
    },

    listAllProducts: () => products.findAll(),

    /** Any product, draft or for sale: what the back office edits. */
    async getProduct(id: string): Promise<Product> {
      const product = await products.findById(id);
      if (!product) throw notFound("Product");
      return product;
    },

    /**
     * Adds a product to the catalog. A product's id is its address in the
     * shop, so two products cannot share one: adding a second is refused
     * rather than silently replacing the first.
     */
    async addProduct(product: Product, actor: Actor): Promise<void> {
      const outcome = await products.saveNew(product, recordOf("product.added", product, actor));
      if (outcome === "already_exists") {
        throw conflict(`There is already a product at the address "${product.id}". Choose a different address for this one.`);
      }
    },

    /** Creates the product, or replaces the one with the same id, whole. */
    saveProduct: (product: Product, actor: Actor) => products.save(product, recordOf("product.saved", product, actor)),

    /** Removing a product that is not there changes nothing, so it succeeds and records nothing. */
    async removeProduct(id: string, actor: Actor): Promise<void> {
      const product = await products.findById(id);
      if (product) await products.remove(id, recordOf("product.removed", product, actor));
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
