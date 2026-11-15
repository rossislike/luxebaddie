import type { Activity, ActivitySubjectKind } from "@luxebaddie/contracts";
import { applicationAttributes, assertType, type TableItem } from "./schema";

/**
 * Activity log entry: one back-office change, with who made it and when.
 *
 *   PK        ACTIVITY                                   the whole log...
 *   SK        ACTIVITY#<at>#<id>                         ...in the order things happened
 *   GSI1PK    ACTIVITY#<SUBJECT KIND>#<subjectId>        one product's or order's history...
 *   GSI1SK    ACTIVITY#<at>#<id>                         ...in the same order
 *
 * Entries are only ever added, in the same transaction as the change they
 * describe. The time leads the sort key so that "the latest" is one end of
 * the collection; the id after it keeps two entries from the same millisecond apart.
 */
export const ACTIVITY_PARTITION = "ACTIVITY";

const inOrderOfTime = (activity: Pick<Activity, "at" | "id">) => `ACTIVITY#${activity.at}#${activity.id}`;

export function subjectHistoryPartition(kind: ActivitySubjectKind, subjectId: string): string {
  return `ACTIVITY#${kind.toUpperCase()}#${subjectId}`;
}

export function activityToItem(activity: Activity): TableItem {
  return {
    PK: ACTIVITY_PARTITION,
    SK: inOrderOfTime(activity),
    GSI1PK: subjectHistoryPartition(activity.subject.kind, activity.subject.id),
    GSI1SK: inOrderOfTime(activity),
    Type: "Activity",
    ...activity,
  };
}

export function activityFromItem(item: Record<string, unknown>): Activity {
  assertType(item, "Activity");
  return applicationAttributes<Activity>(item);
}
