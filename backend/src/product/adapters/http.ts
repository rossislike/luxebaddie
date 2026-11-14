import { categorySlugSchema, productSchema } from "@luxebaddy/contracts";
import { type HttpHandler, httpRouter, parseBody, pathParam } from "../../shared/adapters/api-gateway";
import { invalid } from "../../shared/errors";
import type { CatalogService } from "../application/catalog-service";

/**
 * Public (storefront):
 *   GET    /product              products for sale, optional ?category=
 *   GET    /product/{id}         one product for sale
 * Admin (IAM-signed requests only):
 *   GET    /admin/product        every product, drafts included
 *   PUT    /admin/product/{id}   create or replace a product
 *   DELETE /admin/product/{id}
 */
export function productHttpHandler(catalog: CatalogService): HttpHandler {
  return httpRouter({
    "GET /product": async (event) => {
      const requested = event.queryStringParameters?.category;
      const category = requested === undefined ? undefined : categorySlugSchema.safeParse(requested).data;
      if (requested !== undefined && !category) throw invalid(`Unknown category ${requested}`);
      return { body: { products: await catalog.listProductsForSale(category) } };
    },

    "GET /product/{id}": async (event) => ({
      body: { product: await catalog.getProductForSale(pathParam(event, "id")) },
    }),

    "GET /admin/product": async () => ({ body: { products: await catalog.listAllProducts() } }),

    "PUT /admin/product/{id}": async (event) => {
      const product = parseBody(event, productSchema);
      if (product.id !== pathParam(event, "id")) throw invalid("Product id in the body must match the URL");
      await catalog.saveProduct(product);
      return { body: { product } };
    },

    "DELETE /admin/product/{id}": async (event) => {
      await catalog.removeProduct(pathParam(event, "id"));
      return { statusCode: 204, body: null };
    },
  });
}
