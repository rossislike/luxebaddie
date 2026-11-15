import { type Activity, activitySubjectKindSchema, type Page } from "@luxebaddie/contracts";
import { backOfficeRoutes, type HttpHandler, httpRouter, pathParam } from "../../shared/adapters/api-gateway";
import { pageRequest } from "../../shared/adapters/paging";
import { invalid } from "../../shared/errors";
import type { ActivityService } from "../application/activity-service";

/**
 * Back office (under /admin and /backoffice, see shared/back-office.ts):
 *   GET /activity                 every back-office change, newest first
 *   GET /activity/{kind}/{id}     the changes to one product or order, newest first
 *
 * Both are paged: ?limit= and ?cursor=. There is no route that writes.
 */
export function activityHttpHandler(activity: ActivityService): HttpHandler {
  return httpRouter(
    backOfficeRoutes({
      "GET /activity": async (event) => ({ body: toListResponse(await activity.listRecent(pageRequest(event))) }),

      "GET /activity/{kind}/{id}": async (event) => {
        const kind = activitySubjectKindSchema.safeParse(pathParam(event, "kind"));
        if (!kind.success) throw invalid("Activity is kept for products and orders");
        return { body: toListResponse(await activity.listForSubject(kind.data, pathParam(event, "id"), pageRequest(event))) };
      },
    }),
  );
}

const toListResponse = (page: Page<Activity>) => ({ activity: page.items, nextCursor: page.nextCursor });
