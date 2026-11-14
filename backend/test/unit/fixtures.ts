import type { CheckoutCompleted, Product } from "@luxebaddy/contracts";

export const wig: Product = {
  id: "test-wig",
  name: "Test Wig",
  category: "wigs",
  tagline: "A wig for tests",
  description: "Used by unit tests.",
  highlights: [],
  optionNames: ["Length"],
  images: ["https://cdn.example.com/test-wig.jpg"],
  status: "active",
  featured: false,
  position: 1,
  variants: [
    { sku: "TW-16", options: { Length: '16"' }, priceCents: 10_000, active: true },
    { sku: "TW-20", options: { Length: '20"' }, priceCents: 14_000, active: true },
    { sku: "TW-24", options: { Length: '24"' }, priceCents: 18_000, active: false },
  ],
};

export const lashes: Product = {
  id: "test-lashes",
  name: "Test Lashes",
  category: "lashes",
  tagline: "Lashes for tests",
  description: "Used by unit tests.",
  highlights: [],
  optionNames: [],
  images: [],
  status: "active",
  featured: false,
  position: 2,
  variants: [{ sku: "TL", options: {}, priceCents: 1_500, active: true }],
};

export const catalog = (...products: Product[]) => new Map(products.map((p) => [p.id, p]));

export const BASKET_ID = "11111111-1111-4111-8111-111111111111";

export const paidCheckout: CheckoutCompleted = {
  checkoutSessionId: "cs_test_abc123",
  paymentIntentId: "pi_123",
  basketId: BASKET_ID,
  email: "buyer@example.com",
  customerName: "Bea Buyer",
  phone: "+15555550100",
  shippingName: "Bea Buyer",
  shippingAddress: { line1: "1 Main St", line2: null, city: "Atlanta", state: "GA", postalCode: "30301", country: "US" },
  items: [{ productId: "test-wig", sku: "TW-16", description: 'Test Wig - 16"', unitPriceCents: 10_000, quantity: 1 }],
  subtotalCents: 10_000,
  discountCents: 0,
  shippingCents: 795,
  taxCents: 0,
  totalCents: 10_795,
  currency: "usd",
  paidAt: "2026-11-14T12:00:00.000Z",
};
