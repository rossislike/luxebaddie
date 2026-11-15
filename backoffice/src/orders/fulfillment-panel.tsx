"use client";

import type { FulfillmentStep, Order, Shipment } from "@luxebaddie/contracts";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { messageOf } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { correctShipment, getOrder, takeFulfillmentStep } from "./api";
import { COMMON_CARRIERS, trackingPage } from "./fulfillment";

/**
 * Where an order is on its way to the customer, and the one thing that can be
 * done next. The steps only go forward, so each asks for a second click.
 */
export function FulfillmentPanel({ order, onChanged }: { order: Order; onChanged: (order: Order) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Runs a change, shows the order as the server returns it, and reports a refusal in the server's own words. */
  async function save(change: () => Promise<Order>) {
    setSaving(true);
    setError(null);
    try {
      onChanged(await change());
    } catch (failure) {
      setError(messageOf(failure));
      await showOrderAsStored();
    } finally {
      setSaving(false);
    }
  }

  /**
   * After a failed change the order on screen may be out of date: someone else
   * moved it on, or the change was stored and only the answer got lost on the
   * way back. Reading it again shows where it really stands.
   */
  async function showOrderAsStored() {
    try {
      onChanged(await getOrder(order.id));
    } catch {
      // The message above already says something went wrong; the order stays as it was shown.
    }
  }
  const take = (step: FulfillmentStep) => save(() => takeFulfillmentStep(order.id, step));

  return (
    <section aria-labelledby="fulfillment-heading" className="panel p-6">
      <h2 id="fulfillment-heading" className="font-display text-2xl">
        Fulfillment
      </h2>

      <ol className="mt-5 space-y-4">
        <Done at={order.paidAt}>Paid</Done>
        {order.orderedFromVendorAt && (
          <Done at={order.orderedFromVendorAt}>
            Ordered from the vendor
            {order.vendorOrderReference && <span className="text-cocoa"> · vendor order {order.vendorOrderReference}</span>}
          </Done>
        )}
        {order.shippedAt && order.shipment && (
          <Done at={order.shippedAt}>
            Shipped with {order.shipment.carrier} · <Tracking shipment={order.shipment} />
          </Done>
        )}
        {order.deliveredAt && <Done at={order.deliveredAt}>Delivered</Done>}
      </ol>

      <div className="mt-6 border-t border-ink/10 pt-6">
        {order.fulfillmentStatus === "unfulfilled" && <OrderFromVendor saving={saving} onSubmit={take} />}
        {order.fulfillmentStatus === "processing" && (
          <ShipmentForm
            legend="Next: the vendor has shipped it"
            submitLabel="Mark as shipped"
            confirmLabel="Click again: mark as shipped"
            saving={saving}
            onSubmit={(shipment) => take({ step: "shipped", shipment })}
          />
        )}
        {order.fulfillmentStatus === "shipped" && order.shipment && (
          <>
            <p className="text-sm text-cocoa">Next: the customer has received it.</p>
            <div className="mt-3">
              <ConfirmButton confirmLabel="Click again: mark as delivered" disabled={saving} onConfirm={() => take({ step: "delivered" })}>
                Mark as delivered
              </ConfirmButton>
            </div>
            <details className="mt-6">
              <summary className="cursor-pointer text-sm underline underline-offset-4">Correct the carrier or tracking number</summary>
              <div className="mt-4">
                <ShipmentForm
                  legend="Replace the tracking details"
                  submitLabel="Save tracking"
                  initial={order.shipment}
                  saving={saving}
                  onSubmit={(shipment) => save(() => correctShipment(order.id, shipment))}
                />
              </div>
            </details>
          </>
        )}
        {order.fulfillmentStatus === "delivered" && <p className="text-sm text-leaf">This order is complete.</p>}
        {error && (
          <p role="alert" className="mt-4 border border-wine/30 bg-blush/50 px-4 py-3 text-sm text-wine">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function Done({ at, children }: { at: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="text-leaf">
        ✓
      </span>
      <span>
        <span className="block">{children}</span>
        <span className="block text-sm text-cocoa">{formatDateTime(at)}</span>
      </span>
    </li>
  );
}

function Tracking({ shipment }: { shipment: Shipment }) {
  const page = trackingPage(shipment);
  if (!page) return <span data-testid="tracking-number">{shipment.trackingNumber}</span>;
  return (
    <a href={page} target="_blank" rel="noreferrer" className="underline underline-offset-4" data-testid="tracking-number">
      {shipment.trackingNumber}
    </a>
  );
}

function OrderFromVendor({ saving, onSubmit }: { saving: boolean; onSubmit: (step: FulfillmentStep) => void }) {
  const [reference, setReference] = useState("");
  const fieldId = useId();

  return (
    <div>
      <p className="text-sm text-cocoa">Next: place this order with the vendor, then record it here.</p>
      <label htmlFor={fieldId} className="mt-4 block text-sm">
        Vendor&apos;s order number <span className="text-cocoa">(optional)</span>
      </label>
      <input id={fieldId} className="field mt-1 max-w-sm" maxLength={80} value={reference} onChange={(event) => setReference(event.target.value)} />
      <div className="mt-4">
        <ConfirmButton
          confirmLabel="Click again: mark as ordered"
          disabled={saving}
          onConfirm={() => onSubmit({ step: "ordered-from-vendor", vendorOrderReference: reference.trim() || null })}
        >
          Mark as ordered from vendor
        </ConfirmButton>
      </div>
    </div>
  );
}

function ShipmentForm({
  legend,
  submitLabel,
  confirmLabel,
  initial,
  saving,
  onSubmit,
}: {
  legend: string;
  submitLabel: string;
  /** Given when submitting cannot be undone: the form then asks for a second click. */
  confirmLabel?: string;
  initial?: Shipment;
  saving: boolean;
  onSubmit: (shipment: Shipment) => void;
}) {
  const [carrier, setCarrier] = useState(initial?.carrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(initial?.trackingNumber ?? "");
  const carrierId = useId();
  const trackingId = useId();
  const carriersId = useId();
  const shipment = { carrier: carrier.trim(), trackingNumber: trackingNumber.trim() };
  const complete = shipment.carrier !== "" && shipment.trackingNumber !== "";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (complete && !confirmLabel) onSubmit(shipment);
  }

  return (
    <form onSubmit={submit}>
      <fieldset>
        <legend className="text-sm text-cocoa">{legend}</legend>
        <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-[10rem_1fr]">
          <div>
            <label htmlFor={carrierId} className="block text-sm">
              Carrier
            </label>
            <input
              id={carrierId}
              className="field mt-1"
              list={carriersId}
              maxLength={60}
              required
              value={carrier}
              onChange={(event) => setCarrier(event.target.value)}
            />
            <datalist id={carriersId}>
              {COMMON_CARRIERS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor={trackingId} className="block text-sm">
              Tracking number
            </label>
            <input
              id={trackingId}
              className="field mt-1"
              maxLength={80}
              required
              autoComplete="off"
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
            />
          </div>
        </div>
      </fieldset>
      <div className="mt-4">
        {confirmLabel ? (
          <ConfirmButton confirmLabel={confirmLabel} disabled={saving || !complete} onConfirm={() => onSubmit(shipment)}>
            {submitLabel}
          </ConfirmButton>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={saving || !complete}>
            {submitLabel}
          </button>
        )}
      </div>
    </form>
  );
}
