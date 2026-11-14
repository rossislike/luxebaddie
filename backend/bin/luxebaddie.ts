#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LuxeBaddieStack } from "../lib/luxebaddie-stack";
import { stageConfigFor } from "../lib/stage-config";

const app = new cdk.App();

// Pick the stage with `-c stage=dev`. Each stage is a fully separate copy of the backend.
const config = stageConfigFor(app.node.tryGetContext("stage") ?? "dev");

new LuxeBaddieStack(app, `LuxeBaddie-${config.stage}`, {
  config,
  description: `LuxeBaddie store backend (${config.stage})`,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  tags: { app: "luxebaddie", stage: config.stage },
});
