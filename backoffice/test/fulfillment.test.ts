import { FULFILLMENT_STATUSES } from "@luxebaddie/contracts";
import { describe, expect, it } from "vitest";
import { QUEUES, STATUS_NAMES, trackingPage } from "@/orders/fulfillment";

describe("the order queues", () => {
  it("are one per fulfillment status, in the order an order passes through them", () => {
    expect(QUEUES.map((queue) => queue.status)).toEqual([...FULFILLMENT_STATUSES]);
  });

  it("go by the same names as the statuses", () => {
    for (const { status, name } of QUEUES) expect(name).toBe(STATUS_NAMES[status]);
  });
});

describe("trackingPage", () => {
  it.each([
    ["USPS", "tools.usps.com"],
    ["ups", "www.ups.com"],
    [" FedEx ", "www.fedex.com"],
    ["DHL", "www.dhl.com"],
  ])("links a %s shipment to the carrier's own tracking page", (carrier, host) => {
    const page = new URL(trackingPage({ carrier, trackingNumber: "ABC123" })!);

    expect(page.host).toBe(host);
    expect(page.href).toContain("ABC123");
  });

  it("has no link for a carrier it does not know", () => {
    expect(trackingPage({ carrier: "Vendor Courier", trackingNumber: "ABC123" })).toBeNull();
  });

  it("keeps a tracking number from changing the address it is put in", () => {
    expect(trackingPage({ carrier: "UPS", trackingNumber: "1&to=evil" })).toBe("https://www.ups.com/track?tracknum=1%26to%3Devil");
  });
});
