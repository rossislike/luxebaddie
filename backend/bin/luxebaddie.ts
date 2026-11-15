#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LuxeBaddieDeployAccessStack } from "../lib/deploy-access-stack";
import { LuxeBaddieStack } from "../lib/luxebaddie-stack";
import { stackNames, stageConfigFor } from "../lib/stage-config";

const app = new cdk.App();

// Pick the stage with `-c stage=dev`. Each stage is a fully separate copy of the backend.
const config = stageConfigFor(app.node.tryGetContext("stage") ?? "dev");

const names = stackNames(config.stage);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
const tags = { app: "luxebaddie", stage: config.stage };

new LuxeBaddieStack(app, names.store, {
  config,
  description: `LuxeBaddie store backend (${config.stage})`,
  env,
  tags,
});

// Deployed by hand, once per stage. The pipeline deploys the store stack only.
new LuxeBaddieDeployAccessStack(app, names.deployAccess, {
  config,
  description: `Roles GitHub Actions uses to deploy LuxeBaddie (${config.stage})`,
  env,
  tags,
});
