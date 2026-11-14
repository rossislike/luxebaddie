/** The outcome of asking for a build. */
export type BuildRequest = { outcome: "started"; buildId: string } | { outcome: "busy" };

/**
 * Builds the storefront's pages from the current catalog and puts them live.
 * Implemented by an adapter (AWS CodeBuild today).
 */
export interface StorefrontBuilder {
  /**
   * Starts a build, unless one is already running: only one build may run at a
   * time, so that an older build can never finish last and overwrite a newer one.
   */
  startBuild(): Promise<BuildRequest>;
}
