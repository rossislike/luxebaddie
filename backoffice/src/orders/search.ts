/** What the owner typed into the order search box, understood. */
export type SearchTarget = { kind: "order"; orderId: string } | { kind: "customer"; email: string };

/** An order number as customers quote it: LB-7K3M9Q2XAB, with or without the dash, in any capitalisation. */
const ORDER_NUMBER = /^LB-?([0-9A-Z]{10})$/i;

/** An order number finds that order; anything with an @ finds that customer's orders. Null if it is neither. */
export function searchTarget(typed: string): SearchTarget | null {
  const text = typed.trim();
  const orderNumber = text.match(ORDER_NUMBER);
  if (orderNumber) return { kind: "order", orderId: `LB-${orderNumber[1]!.toUpperCase()}` };
  if (/^\S+@\S+$/.test(text)) return { kind: "customer", email: text };
  return null;
}

export const orderPage = (orderId: string) => `/order?id=${encodeURIComponent(orderId)}`;
export const customerPage = (email: string) => `/customer?email=${encodeURIComponent(email)}`;

export function searchPage(target: SearchTarget): string {
  return target.kind === "order" ? orderPage(target.orderId) : customerPage(target.email);
}
