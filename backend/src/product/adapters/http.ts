import { categorySlugSchema, photoUploadRequestSchema, productSchema } from "@luxebaddie/contracts";
import { backOfficeRoutes, type HttpHandler, httpRouter, parseBody, pathParam } from "../../shared/adapters/api-gateway";
import { invalid } from "../../shared/errors";
import type { CatalogService } from "../application/catalog-service";

/**
 * Public (storefront):
 *   GET    /product              products for sale, optional ?category=
 *   GET    /product/{id}         one product for sale
 * Back office (under /admin and /backoffice, see shared/back-office.ts):
 *   GET    /product              every product, drafts included
 *   POST   /product              add a product; refused if its id is taken
 *   GET    /product/{id}         one product, draft or for sale
 *   PUT    /product/{id}         create or replace a product
 *   DELETE /product/{id}
 *   POST   /product-photo        permission to upload one product photo
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

    ...backOfficeRoutes({
      "GET /product": async () => ({ body: { products: await catalog.listAllProducts() } }),

      "POST /product": async (event) => {
        const product = parseBody(event, productSchema);
        await catalog.addProduct(product);
        return { statusCode: 201, body: { product } };
      },

      "GET /product/{id}": async (event) => ({
        body: { product: await catalog.getProduct(pathParam(event, "id")) },
      }),

      "PUT /product/{id}": async (event) => {
        const product = parseBody(event, productSchema);
        if (product.id !== pathParam(event, "id")) throw invalid("Product id in the body must match the URL");
        await catalog.saveProduct(product);
        return { body: { product } };
      },

      "DELETE /product/{id}": async (event) => {
        await catalog.removeProduct(pathParam(event, "id"));
        return { statusCode: 204, body: null };
      },

      "POST /product-photo": async (event) => {
        const { contentType } = parseBody(event, photoUploadRequestSchema);
        return { statusCode: 201, body: { upload: await catalog.startPhotoUpload(contentType) } };
      },
    }),
  });
}
