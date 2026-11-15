import type { FulfillmentStatus, Shipment } from "@luxebaddie/contracts";

/** The work queues, in the order an order passes through them, in the owner's words. */
export const QUEUES: { status: FulfillmentStatus; name: string; emptyMessage: string }[] = [
  { status: "unfulfilled", name: "To order", emptyMessage: "Nothing is waiting to be ordered from the vendor." },
  { status: "processing", name: "Ordered from vendor", emptyMessage: "No orders are waiting on the vendor to ship." },
  { status: "shipped", name: "On its way", emptyMessage: "No orders are on their way." },
  { status: "delivered", name: "Delivered", emptyMessage: "No orders have been delivered yet." },
];

export const STATUS_NAMES: Record<FulfillmentStatus, string> = {
  unfulfilled: "To order",
  processing: "Ordered from vendor",
  shipped: "On its way",
  delivered: "Delivered",
};

/** Carriers offered as suggestions. Any other name can be typed. */
export const COMMON_CARRIERS = ["USPS", "UPS", "FedEx", "DHL"];

const TRACKING_PAGES: Record<string, (trackingNumber: string) => string> = {
  usps: (number) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`,
  ups: (number) => `https://www.ups.com/track?tracknum=${number}`,
  fedex: (number) => `https://www.fedex.com/fedextrack/?trknbr=${number}`,
  dhl: (number) => `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${number}`,
};

/** The carrier's own tracking page for a shipment, for the carriers we know. Null for any other. */
export function trackingPage({ carrier, trackingNumber }: Shipment): string | null {
  const page = TRACKING_PAGES[carrier.trim().toLowerCase()];
  return page ? page(encodeURIComponent(trackingNumber.trim())) : null;
}
