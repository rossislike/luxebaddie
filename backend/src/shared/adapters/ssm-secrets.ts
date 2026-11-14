import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { awsClientDefaults } from "./aws-clients";

export type SecretReader = (parameterName: string) => Promise<string>;

const CACHE_MS = 5 * 60 * 1000;

/**
 * Reads encrypted SSM parameters, cached for a few minutes per Lambda
 * container so a rotated secret is picked up without a redeploy. Secrets live
 * in Parameter Store rather than environment variables so they never appear in
 * CloudFormation templates or the Lambda console.
 */
export function createSecretReader(ssm = new SSMClient(awsClientDefaults)): SecretReader {
  const cache = new Map<string, { value: Promise<string>; expiresAt: number }>();

  return (parameterName) => {
    const cached = cache.get(parameterName);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = ssm
      .send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }))
      .then((result) => {
        const secret = result.Parameter?.Value;
        if (!secret) throw new Error(`SSM parameter ${parameterName} is empty`);
        return secret;
      })
      .catch((error) => {
        cache.delete(parameterName); // let the next invocation retry
        throw error;
      });
    cache.set(parameterName, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  };
}
