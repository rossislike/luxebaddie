import type { Activity, ActivitySubjectKind, Page } from "@luxebaddie/contracts";
import type { PageRequest } from "../../shared/paging";

/**
 * The activity log, for reading. Entries are written by the services that
 * make the changes, each together with its change; nothing here can add,
 * alter or remove one.
 */
export interface ActivityLog {
  /** Everything that was changed through the back office, newest first. */
  findRecent(page: PageRequest): Promise<Page<Activity>>;
  /** The changes made to one product or one order, newest first. */
  findForSubject(kind: ActivitySubjectKind, subjectId: string, page: PageRequest): Promise<Page<Activity>>;
}
