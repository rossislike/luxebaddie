import {
  CloudFormationClient,
  DescribeStacksCommand,
  paginateDescribeStackEvents,
} from "@aws-sdk/client-cloudformation";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { AwsClient } from "aws4fetch";
import { DEPLOYMENT_FINISHED_STATUSES } from "../../lib/build-stamp";
import { stackNames } from "../../lib/stage-config";

export type StackOutputs = {
  ApiUrl: string;
  StorefrontUrl: string;
  StorefrontBucketName: string;
  StorefrontBuildProject: string;
  BackOfficeUrl: string;
  BackOfficeBucketName: string;
  BackOfficeBuildProject: string;
  StripeWebhookUrl: string;
  EventBusName: string;
  TableName: string;
  OwnerUserPoolId: string;
  OwnerUserPoolClientId: string;
  OwnerSignInIssuer: string;
  OwnerSignInPagesUrl: string;
  OrderDeadLetterQueueUrl: string;
};

/** Reads the deployed stack's outputs (API URL, table names, ...) from CloudFormation. */
export async function getStackOutputs(stage: string): Promise<StackOutputs> {
  const stackName = stackNames(stage).store;
  const cloudFormation = new CloudFormationClient({});
  const { Stacks } = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = Object.fromEntries((Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
  if (!outputs.ApiUrl) throw new Error(`Stack ${stackName} has no ApiUrl output. Is it deployed?`);
  return outputs as StackOutputs;
}

/**
 * When the stage's most recent deployment finished, or null if CloudFormation
 * no longer remembers one (it keeps a stack's history for 90 days).
 */
export async function lastDeploymentFinishedAt(stage: string): Promise<Date | null> {
  const stackName = stackNames(stage).store;
  const pages = paginateDescribeStackEvents({ client: new CloudFormationClient({}) }, { StackName: stackName });
  // Newest first. The stack's own events are the ones that describe a whole deployment.
  for await (const { StackEvents = [] } of pages) {
    const finished = StackEvents.find(
      (event) =>
        event.ResourceType === "AWS::CloudFormation::Stack" &&
        event.LogicalResourceId === stackName &&
        DEPLOYMENT_FINISHED_STATUSES.includes(event.ResourceStatus ?? ""),
    );
    if (finished?.Timestamp) return finished.Timestamp;
  }
  return null;
}

/**
 * A fetch that signs requests with your AWS credentials (SigV4), which is what
 * the /admin routes require.
 */
export async function createAdminFetch(): Promise<typeof fetch> {
  const credentials = await fromNodeProviderChain()();
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    service: "execute-api",
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
  });
  return (input, init) => client.fetch(input as string | URL | Request, init);
}

export function stageFromArgs(): string {
  const stage = process.argv[2];
  if (!stage) throw new Error("Usage: pass the stage name, e.g. `dev`");
  return stage;
}
