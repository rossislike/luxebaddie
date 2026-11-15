import { type Address, formatMoney, type Order } from "@luxebaddie/contracts";
import Link from "next/link";
import type { ReactNode } from "react";
import { customerPage } from "./search";

/** Stripe's Dashboard, searched for this payment. It opens in whichever Stripe account or sandbox was used last. */
const stripePaymentPage = (paymentIntentId: string) => `https://dashboard.stripe.com/search?query=${encodeURIComponent(paymentIntentId)}`;

/** What was bought, who bought it and where it goes. Fixed at purchase: nothing here can be edited. */
export function OrderDetails({ order }: { order: Order }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section aria-labelledby="items-heading" className="panel p-6">
        <h2 id="items-heading" className="font-display text-2xl">
          Items
        </h2>
        <ul className="mt-4 divide-y divide-ink/10">
          {order.items.map((item) => (
            <li key={item.sku} className="flex justify-between gap-6 py-3">
              <span>
                {item.description} <span className="text-cocoa">× {item.quantity}</span>
                <span className="block text-sm text-cocoa">SKU {item.sku}</span>
              </span>
              <span>{formatMoney(item.unitPriceCents * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 border-t border-ink/10 pt-4 text-sm">
          <Amount label="Subtotal" cents={order.subtotalCents} />
          {order.discountCents > 0 && <Amount label="Discount" cents={-order.discountCents} />}
          <Amount label="Shipping" cents={order.shippingCents} />
          {order.taxCents > 0 && <Amount label="Tax" cents={order.taxCents} />}
          <div className="flex justify-between border-t border-ink/10 pt-3 text-base font-medium">
            <dt>Total paid</dt>
            <dd data-testid="order-total">{formatMoney(order.totalCents)}</dd>
          </div>
        </dl>
        {order.paymentIntentId && (
          <p className="mt-5 text-sm">
            <a href={stripePaymentPage(order.paymentIntentId)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              Open the payment in Stripe
            </a>
          </p>
        )}
      </section>

      <div className="space-y-6">
        <Card title="Ship to">
          {order.shippingAddress ? (
            <ShippingLabel name={order.shippingName} address={order.shippingAddress} />
          ) : (
            <p className="text-cocoa">No shipping address was given.</p>
          )}
        </Card>
        <Card title="Customer">
          <p>{order.customerName ?? "No name given"}</p>
          {order.email && (
            <p className="break-words">
              <Link href={customerPage(order.email)} className="underline underline-offset-4">
                {order.email}
              </Link>
            </p>
          )}
          {order.phone && <p>{order.phone}</p>}
        </Card>
      </div>
    </div>
  );
}

function Amount({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd>{cents === 0 ? "Free" : formatMoney(cents)}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-6">
      <h2 className="eyebrow">{title}</h2>
      <div className="mt-3 space-y-1">{children}</div>
    </section>
  );
}

/** The address laid out as it goes on a parcel, so it can be copied to the vendor as is. */
function ShippingLabel({ name, address }: { name: string | null; address: Address }) {
  return (
    <address className="not-italic" data-testid="ship-to">
      {name}
      <br />
      {address.line1}
      {address.line2 && (
        <>
          <br />
          {address.line2}
        </>
      )}
      <br />
      {address.city}, {address.state} {address.postalCode}
      <br />
      {address.country}
    </address>
  );
}
