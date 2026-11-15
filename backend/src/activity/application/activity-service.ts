import type { ActivitySubjectKind } from "@luxebaddie/contracts";
import type { PageRequest } from "../../shared/paging";
import type { ActivityLog } from "./ports";

/** Activity log use cases: looking back at what was changed, by whom and when. */
export function createActivityService(log: ActivityLog) {
  return {
    listRecent: (page: PageRequest) => log.findRecent(page),

    listForSubject: (kind: ActivitySubjectKind, subjectId: string, page: PageRequest) => log.findForSubject(kind, subjectId, page),
  };
}

export type ActivityService = ReturnType<typeof createActivityService>;
