/**
 * Shipping policy. Placeholder numbers until vendor shipping costs are known
 * (see ROADMAP.md): flat-rate standard shipping, free above a threshold.
 */
export const STANDARD_SHIPPING_CENTS = 795;
export const FREE_SHIPPING_THRESHOLD_CENTS = 15_000;

export function shippingCentsFor(subtotalCents: number): number {
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : STANDARD_SHIPPING_CENTS;
}
