import { z } from "zod";

/**
 * The activity log: one entry for every change made through the back office,
 * with who made it and when. Entries are written together with the change
 * they describe and are never edited or removed.
 */
export const ACTIVITY_ACTIONS = [
  "product.added",
  "product.saved",
  "product.removed",
  "order.ordered-from-vendor",
  "order.shipped",
  "order.delivered",
  "order.shipment-corrected",
] as const;
export const activityActionSchema = z.enum(ACTIVITY_ACTIONS);
export type ActivityAction = z.infer<typeof activityActionSchema>;

/**
 * Who made a change: the owner signed in to the back office, or something
 * using the store's AWS access (a script, an automation, the tests).
 */
export const actorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owner"), email: z.string() }),
  /** `identity` is the AWS identity's own name, e.g. "user/devAdmin". */
  z.object({ kind: z.literal("automation"), identity: z.string() }),
]);
export type Actor = z.infer<typeof actorSchema>;

export const ACTIVITY_SUBJECT_KINDS = ["product", "order"] as const;
export const activitySubjectKindSchema = z.enum(ACTIVITY_SUBJECT_KINDS);
export type ActivitySubjectKind = z.infer<typeof activitySubjectKindSchema>;

/** What was changed. `label` is how it was known at the time: a product's name, an order's number. */
export const activitySubjectSchema = z.object({
  kind: activitySubjectKindSchema,
  id: z.string(),
  label: z.string(),
});
export type ActivitySubject = z.infer<typeof activitySubjectSchema>;

export const activitySchema = z.object({
  id: z.string(),
  /** ISO timestamp. */
  at: z.string(),
  actor: actorSchema,
  action: activityActionSchema,
  subject: activitySubjectSchema,
  /** A detail worth keeping, e.g. the tracking number entered. Null when the action says it all. */
  note: z.string().nullable(),
});
export type Activity = z.infer<typeof activitySchema>;
