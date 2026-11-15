import { randomUUID } from "node:crypto";
import type { Activity, ActivityAction, ActivitySubject, Actor } from "@luxebaddie/contracts";

/** A change about to be made through the back office: who is making it, to what, and what kind of change it is. */
export type Change = {
  actor: Actor;
  action: ActivityAction;
  subject: ActivitySubject;
  note?: string | null;
};

/**
 * The activity log entry for a change. A service builds one for every
 * back-office change and hands it to its repository together with the change,
 * which stores the two in one transaction: no change without its entry, and
 * no entry for a change that did not happen.
 */
export function activityFor(change: Change, at: Date, id: string = randomUUID()): Activity {
  return {
    id,
    at: at.toISOString(),
    actor: change.actor,
    action: change.action,
    subject: change.subject,
    note: change.note ?? null,
  };
}
