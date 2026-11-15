/**
 * Waits until the stage's live storefront is the one built after its last
 * deployment, so whatever runs next (the end-to-end tests, a person checking
 * the site) sees what was just deployed and not the version before it.
 *
 *   pnpm --filter @luxebaddie/backend storefront:wait:dev
 *
 * A deployment only starts a storefront build (lib/storefront-build.ts); the
 * site changes a few minutes later, once that build has published. Every build
 * records when it started on the site itself (lib/build-stamp.ts), so the
 * check is made against what shoppers are actually served.
 *
 * Fails if no such build goes live in time, which means the build failed or
 * never started. The previous version of the site stays up when that happens.
 */
import { BUILD_STAMP_PATH, type BuildStamp } from "../lib/build-stamp";
import { getStackOutputs, lastDeploymentFinishedAt, stageFromArgs } from "./lib/aws";

/**
 * Longer than a rebuild takes at its slowest: the rebuild request is collected
 * for 30 seconds, may wait several minutes for a build that is already running
 * to end, and the build itself takes a few minutes.
 */
const TIMEOUT_MS = 15 * 60_000;
const POLL_MS = 10_000;

const stage = stageFromArgs();
const { StorefrontUrl, StorefrontBuildProject } = await getStackOutputs(stage);
const deployedAt = (await lastDeploymentFinishedAt(stage)) ?? new Date(0);

/**
 * When the build that produced the live site started. Null if the site does
 * not say (it was published before builds recorded this) or cannot be reached
 * right now.
 */
async function liveBuildStartedAt(): Promise<Date | null> {
  try {
    const response = await fetch(`${StorefrontUrl}/${BUILD_STAMP_PATH}`, { signal: AbortSignal.timeout(POLL_MS) });
    if (!response.ok) return null;
    const { startedAt } = (await response.json()) as BuildStamp;
    return new Date(startedAt);
  } catch {
    return null;
  }
}

console.log(`The last deployment of ${stage} finished at ${deployedAt.toISOString()}.`);
console.log(`Waiting for a storefront build that started after it to be live at ${StorefrontUrl} ...`);

const deadline = Date.now() + TIMEOUT_MS;
let builtAt = await liveBuildStartedAt();
while (!builtAt || builtAt <= deployedAt) {
  if (Date.now() > deadline) {
    const live = builtAt ? `was built at ${builtAt.toISOString()}` : "does not say when it was built";
    console.error(
      `No storefront build that started after the deployment went live within ${TIMEOUT_MS / 60_000} minutes. ` +
        `The live storefront ${live}. Look at the latest build of the CodeBuild project ${StorefrontBuildProject}.`,
    );
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  builtAt = await liveBuildStartedAt();
}
console.log(`The live storefront was built at ${builtAt.toISOString()}. It is up to date.`);
