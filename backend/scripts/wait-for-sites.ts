/**
 * Waits until the stage's live sites (storefront and back office) are the
 * ones built after its last deployment, so whatever runs next (the end-to-end
 * tests, a person checking a site) sees what was just deployed and not the
 * version before it.
 *
 *   pnpm --filter @luxebaddie/backend sites:wait:dev
 *
 * A deployment only starts the builds (lib/site-build.ts); a site changes a
 * few minutes later, once its build has published. Every build records when it
 * started on the site itself (lib/build-stamp.ts), so the check is made
 * against what visitors are actually served.
 *
 * Fails if a site gets no such build in time, which means the build failed or
 * never started. The previous version of that site stays up when that happens.
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

type LiveSite = { title: string; url: string; buildProject: string };

const stage = stageFromArgs();
const outputs = await getStackOutputs(stage);
const sites: LiveSite[] = [
  { title: "storefront", url: outputs.StorefrontUrl, buildProject: outputs.StorefrontBuildProject },
  { title: "back office", url: outputs.BackOfficeUrl, buildProject: outputs.BackOfficeBuildProject },
];
const deployedAt = (await lastDeploymentFinishedAt(stage)) ?? new Date(0);
const deadline = Date.now() + TIMEOUT_MS;

/**
 * When the build that produced the live site started. Null if the site does
 * not say (it was published before builds recorded this) or cannot be reached
 * right now.
 */
async function liveBuildStartedAt(site: LiveSite): Promise<Date | null> {
  try {
    const response = await fetch(`${site.url}/${BUILD_STAMP_PATH}`, { signal: AbortSignal.timeout(POLL_MS) });
    if (!response.ok) return null;
    const { startedAt } = (await response.json()) as BuildStamp;
    return new Date(startedAt);
  } catch {
    return null;
  }
}

/** Resolves once the site is up to date. Throws, saying where to look, if that takes too long. */
async function upToDate(site: LiveSite): Promise<void> {
  console.log(`Waiting for a ${site.title} build that started after the deployment to be live at ${site.url} ...`);
  let builtAt = await liveBuildStartedAt(site);
  while (!builtAt || builtAt <= deployedAt) {
    if (Date.now() > deadline) {
      const live = builtAt ? `was built at ${builtAt.toISOString()}` : "does not say when it was built";
      throw new Error(
        `No ${site.title} build that started after the deployment went live within ${TIMEOUT_MS / 60_000} minutes. ` +
          `The live ${site.title} ${live}. Look at the latest build of the CodeBuild project ${site.buildProject}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    builtAt = await liveBuildStartedAt(site);
  }
  console.log(`The live ${site.title} was built at ${builtAt.toISOString()}. It is up to date.`);
}

console.log(`The last deployment of ${stage} finished at ${deployedAt.toISOString()}.`);

const results = await Promise.allSettled(sites.map(upToDate));
const failures = results.filter((result) => result.status === "rejected");
for (const failure of failures) console.error(String(failure.reason.message));
if (failures.length > 0) process.exit(1);
