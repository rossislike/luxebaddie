import type { ReactNode } from "react";
import type { Loaded } from "@/lib/use-loaded";

/** Renders `children` once the data is there, and the waiting and failed states until then. */
export function LoadState<T>({ loaded, children }: { loaded: Loaded<T>; children: (data: T) => ReactNode }) {
  if (loaded.status === "loading") return <p className="text-cocoa">Loading...</p>;
  if (loaded.status === "failed") {
    return (
      <div role="alert" className="border border-wine/30 bg-blush/50 px-4 py-3 text-sm text-wine">
        <p>{loaded.message}</p>
        <button type="button" className="mt-2 underline underline-offset-4" onClick={loaded.reload}>
          Try again
        </button>
      </div>
    );
  }
  return <>{children(loaded.data)}</>;
}
