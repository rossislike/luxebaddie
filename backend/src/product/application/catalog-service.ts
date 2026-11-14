import type { CategorySlug, Product } from "@luxebaddy/contracts";
import { notFound } from "../../shared/errors";
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

    saveProduct: (product: Product) => products.save(product),

    removeProduct: (id: string) => products.remove(id),
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
