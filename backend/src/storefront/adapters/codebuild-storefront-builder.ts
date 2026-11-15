import { type CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";
import type { StorefrontBuilder } from "../application/ports";

/**
 * Builds and publishes the storefront with the stage's CodeBuild project
 * (backend/lib/site-build.ts). The project allows one build at a time;
 * CodeBuild refuses to start a second with this error.
 */
const CONCURRENT_BUILD_LIMIT_ERROR = "AccountLimitExceededException";

export function codeBuildStorefrontBuilder(codeBuild: CodeBuildClient, projectName: string): StorefrontBuilder {
  return {
    async startBuild() {
      try {
        const { build } = await codeBuild.send(new StartBuildCommand({ projectName }));
        if (!build?.id) throw new Error(`CodeBuild started a build of ${projectName} without an id`);
        return { outcome: "started", buildId: build.id };
      } catch (error) {
        if (error instanceof Error && error.name === CONCURRENT_BUILD_LIMIT_ERROR) return { outcome: "busy" };
        throw error;
      }
    },
  };
}
