import type { CategorySlug, Product } from "@luxebaddie/contracts";
import { conflict, notFound } from "../../shared/errors";
import type { ProductRepository } from "./ports";

/** Catalog use cases. Shoppers only ever see products for sale; admins see everything. */
export function createCatalogService(products: ProductRepository) {
  return {
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
    async addProduct(product: Product): Promise<void> {
      const outcome = await products.saveNew(product);
      if (outcome === "already_exists") {
        throw conflict(`There is already a product at the address "${product.id}". Choose a different address for this one.`);
      }
    },

    /** Creates the product, or replaces the one with the same id, whole. */
    saveProduct: (product: Product) => products.save(product),

    removeProduct: (id: string) => products.remove(id),
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
