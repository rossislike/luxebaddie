import type { StorefrontBuilder } from "./ports";

/**
 * Storefront use cases. The storefront is a static site: its pages are built
 * from the catalog ahead of time, so it has to be rebuilt and republished
 * whenever the catalog, or the storefront's own code, changes.
 */
export function createStorefrontService(builder: StorefrontBuilder) {
  return {
    /**
     * Asks for the live storefront to be brought up to date.
     *
     * "deferred" means a build is already running. That build may have read the
     * catalog before the change behind this request, so it does not satisfy
     * it: the caller must ask again later.
     */
    async requestRebuild(): Promise<"started" | "deferred"> {
      const request = await builder.startBuild();
      if (request.outcome === "busy") {
        console.log("A build of the site is already running; this request will be retried");
        return "deferred";
      }
      console.log("Started a build of the site", { buildId: request.buildId });
      return "started";
    },
  };
}

export type StorefrontService = ReturnType<typeof createStorefrontService>;
