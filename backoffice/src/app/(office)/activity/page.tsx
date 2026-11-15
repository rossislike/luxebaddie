"use client";

import { ActivityList } from "@/activity/activity-list";
import { listActivity } from "@/activity/api";

export default function ActivityPage() {
  return (
    <>
      <p className="eyebrow">Activity</p>
      <h1 className="mt-2 font-display text-4xl">What was changed</h1>
      <p className="mt-3 max-w-2xl text-cocoa">
        Every change made to a product or an order from the back office, with who made it and when. Newest first. Entries cannot be edited or
        removed.
      </p>
      <div className="panel mt-8 px-6 py-3">
        <ActivityList load={listActivity} emptyMessage="Nothing has been changed from the back office yet." />
      </div>
    </>
  );
}
