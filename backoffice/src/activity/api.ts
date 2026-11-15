import type { Activity, ActivitySubjectKind } from "@luxebaddie/contracts";
import { backOfficeFetch } from "@/lib/api";

/** One page of the activity log, with the cursor for the next (null on the last page). */
export type ActivityPage = { activity: Activity[]; nextCursor: string | null };

const PAGE_SIZE = 25;
const paging = (cursor: string | null) => `limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;

/** Every back-office change, newest first. */
export const listActivity = (cursor: string | null) => backOfficeFetch<ActivityPage>(`/activity?${paging(cursor)}`);

/** The changes made to one product or one order, newest first. */
export const listHistory = (kind: ActivitySubjectKind, id: string, cursor: string | null) =>
  backOfficeFetch<ActivityPage>(`/activity/${kind}/${encodeURIComponent(id)}?${paging(cursor)}`);
