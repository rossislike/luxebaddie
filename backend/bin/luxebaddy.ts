#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LuxeBaddyStack } from "../lib/luxebaddy-stack";
import { stageConfigFor } from "../lib/stage-config";

const app = new cdk.App();

// Pick the stage with `-c stage=dev`. Each stage is a fully separate copy of the backend.
const config = stageConfigFor(app.node.tryGetContext("stage") ?? "dev");

new LuxeBaddyStack(app, `LuxeBaddy-${config.stage}`, {
  config,
  description: `LuxeBaddy store backend (${config.stage})`,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  tags: { app: "luxebaddy", stage: config.stage },
});
