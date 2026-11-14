/**
 * Storefront microservice: keeps the live storefront in step with the catalog
 * and the deployed code by rebuilding it when either changes.
 * Composition root - the only file that knows which concrete adapters are used.
 */
import { CodeBuildClient } from "@aws-sdk/client-codebuild";
import { awsClientDefaults } from "../shared/adapters/aws-clients";
import { requireEnv } from "../shared/env";
import { codeBuildStorefrontBuilder } from "./adapters/codebuild-storefront-builder";
import { rebuildQueueHandler } from "./adapters/rebuild-queue";
import { createStorefrontService } from "./application/storefront-service";

const builder = codeBuildStorefrontBuilder(new CodeBuildClient(awsClientDefaults), requireEnv("BUILD_PROJECT_NAME"));

export const handler = rebuildQueueHandler(createStorefrontService(builder));
