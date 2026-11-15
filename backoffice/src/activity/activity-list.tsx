"use client";

import type { Activity } from "@luxebaddie/contracts";
import Link from "next/link";
import { useCallback } from "react";
import { formatDateTime } from "@/lib/dates";
import { usePagedList } from "@/lib/use-paged-list";
import type { ActivityPage } from "./api";
import { subjectPage, whatHappened, who } from "./in-words";

/**
 * A stretch of the activity log, newest first, with a "show more" button.
 * `load` must be stable between renders (wrap it in useCallback).
 * `nameSubjects` is off where every entry is about the same thing, which the page already names.
 */
export function ActivityList({
  load,
  emptyMessage,
  nameSubjects = true,
}: {
  load: (cursor: string | null) => Promise<ActivityPage>;
  emptyMessage: string;
  nameSubjects?: boolean;
}) {
  const list = usePagedList(
    useCallback(async (cursor: string | null) => {
      const page = await load(cursor);
      return { items: page.activity, nextCursor: page.nextCursor };
    }, [load]),
  );

  if (list.loading) return <p className="text-cocoa">Loading...</p>;

  return (
    <>
      {list.items.length === 0 && !list.error && <p className="text-cocoa">{emptyMessage}</p>}
      {list.items.length > 0 && (
        <ol className="divide-y divide-ink/10" data-testid="activity">
          {list.items.map((entry) => (
            <li key={entry.id} className="py-3">
              <p>
                <span className="font-medium">{who(entry.actor)}</span> {whatHappened(entry)}
                {nameSubjects && (
                  <>
                    {" "}
                    <Subject entry={entry} />
                  </>
                )}
                {entry.note && <span className="text-cocoa"> · {entry.note}</span>}
              </p>
              <p className="text-sm text-cocoa">{formatDateTime(entry.at)}</p>
            </li>
          ))}
        </ol>
      )}
      {list.error && (
        <p role="alert" className="mt-4 border border-wine/30 bg-blush/50 px-4 py-3 text-sm text-wine">
          {list.error}
        </p>
      )}
      {(list.hasMore || list.error) && (
        <button type="button" className="btn btn-outline mt-4" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? "Loading..." : list.error ? "Try again" : "Show more"}
        </button>
      )}
    </>
  );
}

function Subject({ entry }: { entry: Activity }) {
  const page = subjectPage(entry);
  const name = entry.subject.kind === "order" ? `order ${entry.subject.label}` : entry.subject.label;
  if (!page) return <span>{name}</span>;
  return (
    <Link href={page} className="underline underline-offset-4">
      {name}
    </Link>
  );
}
