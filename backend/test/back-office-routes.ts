/**
 * Every back-office route, without the prefix it is served under. The stack
 * test checks that this is exactly what the API defines, and the end-to-end
 * tests knock on each one, so a route added without being listed here fails
 * the build rather than going untested.
 */
export const BACK_OFFICE_ROUTES = [
  "GET /product",
  "POST /product",
  "GET /product/{id}",
  "PUT /product/{id}",
  "DELETE /product/{id}",
  "POST /product-photo",
  "GET /order",
  "GET /order/{id}",
  "POST /order/{id}/fulfillment-step",
  "PUT /order/{id}/shipment",
  "GET /customer/{email}/order",
  "GET /activity",
  "GET /activity/{kind}/{id}",
] as const;
