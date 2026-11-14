import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Every AWS call gets a timeout and a bounded number of attempts (the SDK
 * retries throttling and transient errors with exponential backoff and
 * jitter). The worst case stays well inside the Lambda timeout.
 */
export const awsClientDefaults = {
  maxAttempts: 3,
  requestHandler: { connectionTimeout: 1000, requestTimeout: 3000 },
};

export function createDocumentClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient(awsClientDefaults), {
    marshallOptions: { removeUndefinedValues: true },
  });
}
