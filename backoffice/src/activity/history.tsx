"use client";

import type { ActivitySubjectKind } from "@luxebaddie/contracts";
import { useCallback } from "react";
import { ActivityList } from "./activity-list";
import { listHistory } from "./api";

/** Every change made to one product or one order, with who made it and when. */
export function History({ kind, id }: { kind: ActivitySubjectKind; id: string }) {
  const load = useCallback((cursor: string | null) => listHistory(kind, id, cursor), [kind, id]);

  return (
    <section aria-labelledby="history-heading" className="panel p-6">
      <h2 id="history-heading" className="font-display text-2xl">
        History
      </h2>
      <div className="mt-3">
        <ActivityList load={load} emptyMessage="Nothing has been changed here from the back office yet." nameSubjects={false} />
      </div>
    </section>
  );
}
