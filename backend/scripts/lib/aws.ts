import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { AwsClient } from "aws4fetch";

export type StackOutputs = {
  ApiUrl: string;
  StripeWebhookUrl: string;
  EventBusName: string;
  TableName: string;
  OrderDeadLetterQueueUrl: string;
};

/** Reads the deployed stack's outputs (API URL, table names, ...) from CloudFormation. */
export async function getStackOutputs(stage: string): Promise<StackOutputs> {
  const cloudFormation = new CloudFormationClient({});
  const { Stacks } = await cloudFormation.send(new DescribeStacksCommand({ StackName: `LuxeBaddy-${stage}` }));
  const outputs = Object.fromEntries((Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
  if (!outputs.ApiUrl) throw new Error(`Stack LuxeBaddy-${stage} has no ApiUrl output. Is it deployed?`);
  return outputs as StackOutputs;
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
