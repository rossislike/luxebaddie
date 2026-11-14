import Stripe from "stripe";
import type { SecretReader } from "./ssm-secrets";

export type StripeProvider = () => Promise<Stripe>;

/**
 * Each service gets its own client, authenticated with that service's
 * restricted API key from Parameter Store.
 *
 * Stripe calls time out after 4 seconds and are retried at most twice. The
 * SDK backs off exponentially with jitter and sends an idempotency key on
 * retried writes, so a retry can never create a second charge or session.
 */
const STRIPE_OPTIONS = { timeout: 4000, maxNetworkRetries: 2 };

export function createStripeProvider(readSecret: SecretReader, apiKeyParameter: string): StripeProvider {
  let current: { key: string; client: Stripe } | undefined;

  return async () => {
    const key = await readSecret(apiKeyParameter);
    if (current?.key !== key) current = { key, client: new Stripe(key, STRIPE_OPTIONS) };
    return current.client;
  };
}
