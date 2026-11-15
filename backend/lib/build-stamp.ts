/**
 * How to tell whether a live site is up to date with a deployment.
 *
 * Every site build records when it started in a small file on the site.
 * A build that started after a deployment finished was built from what that
 * deployment put in place, so comparing the two times answers the question
 * without access to the build system. Written by lib/site-build.ts, read
 * by scripts/wait-for-sites.ts.
 */

/** Where on the site a build records itself. */
export const BUILD_STAMP_PATH = "build.json";

export type BuildStamp = {
  /** ISO 8601 time at which the build that produced the live site started. */
  startedAt: string;
};

/**
 * The CloudFormation statuses that end a deployment and leave the stack in
 * service. A rollback counts: it puts the previous version back.
 */
export const DEPLOYMENT_FINISHED_STATUSES = ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"];
