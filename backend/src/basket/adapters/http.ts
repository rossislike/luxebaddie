import { basketIdSchema, type CheckoutResponse, putBasketRequestSchema } from "@luxebaddie/contracts";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { allowedOrigin, type HttpHandler, httpRouter, parseBody, pathParam } from "../../shared/adapters/api-gateway";
import { invalid } from "../../shared/errors";
import type { BasketService } from "../application/basket-service";

/**
 *   GET    /basket/{id}            the basket with current prices
 *   PUT    /basket/{id}            replace the basket's items
 *   DELETE /basket/{id}
 *   POST   /basket/{id}/checkout   start a hosted checkout
 */
export function basketHttpHandler(basket: BasketService): HttpHandler {
  return httpRouter({
    "GET /basket/{id}": async (event) => ({ body: await basket.viewBasket(basketId(event)) }),

    "PUT /basket/{id}": async (event) => {
      const { items } = parseBody(event, putBasketRequestSchema);
      return { body: await basket.replaceItems(basketId(event), items) };
    },

    "DELETE /basket/{id}": async (event) => {
      await basket.discardBasket(basketId(event));
      return { statusCode: 204, body: null };
    },

    // The shopper returns to whichever of our storefronts made the call (hosted, or local in development).
    "POST /basket/{id}/checkout": async (event) => ({
      body: { url: await basket.startCheckout(basketId(event), allowedOrigin(event)) } satisfies CheckoutResponse,
    }),
  });
}

function basketId(event: APIGatewayProxyEvent): string {
  const parsed = basketIdSchema.safeParse(pathParam(event, "id"));
  if (!parsed.success) throw invalid("Basket id must be a UUID");
  return parsed.data;
}
