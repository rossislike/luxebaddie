import type { Activity, ActivityAction, Actor } from "@luxebaddie/contracts";

const WHAT_HAPPENED: Record<ActivityAction, string> = {
  "product.added": "added the product",
  "product.saved": "saved the product",
  "product.removed": "removed the product",
  "order.ordered-from-vendor": "marked as ordered from the vendor",
  "order.shipped": "marked as shipped",
  "order.delivered": "marked as delivered",
  "order.shipment-corrected": "corrected the tracking of",
};

/** "added the product", "marked as shipped": what was done, to go between who did it and what it was done to. */
export const whatHappened = (activity: Pick<Activity, "action">) => WHAT_HAPPENED[activity.action];

/** Who made a change, as the owner would say it. An automation is named by the AWS identity it used. */
export function who(actor: Actor): string {
  return actor.kind === "owner" ? actor.email : `Automation (${actor.identity.split("/").slice(1).join("/") || actor.identity})`;
}

/** The page of the thing that was changed. A removed product has no page any more. */
export function subjectPage({ subject, action }: Pick<Activity, "subject" | "action">): string | null {
  if (subject.kind === "order") return `/order?id=${encodeURIComponent(subject.id)}`;
  return action === "product.removed" ? null : `/product?id=${encodeURIComponent(subject.id)}`;
}
