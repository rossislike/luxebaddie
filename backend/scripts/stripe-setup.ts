/**
 * Connects a stage to Stripe. Run once per stage, and again to rotate keys.
 *
 * Use a dedicated Stripe sandbox for dev (Dashboard -> Sandboxes), not the
 * shared test mode, and create three restricted keys in it
 * (Developers -> API keys -> Create restricted key):
 *
 *   STRIPE_BASKET_KEY    Checkout Sessions: Write
 *   STRIPE_PAYMENT_KEY   Checkout Sessions: Read, Products: Read
 *   STRIPE_SETUP_KEY     Webhook Endpoints: Write   (used by this script only, never stored)
 *
 *   STRIPE_BASKET_KEY=rk_test_... STRIPE_PAYMENT_KEY=rk_test_... STRIPE_SETUP_KEY=rk_test_... \
 *     pnpm stripe:setup:dev
 *
 * The script stores each service's key encrypted in SSM Parameter Store,
 * registers the stage's webhook endpoint with Stripe, and stores the webhook
 * signing secret. The Lambdas read them from Parameter Store at runtime.
 *
 * For a throwaway sandbox only, STRIPE_SECRET_KEY=sk_test_... can stand in for
 * all three. Production never accepts an unrestricted key.
 */
import { PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import Stripe from "stripe";
import { secretParameterNames } from "../lib/stage-config";
import { getStackOutputs, stageFromArgs } from "./lib/aws";

const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
];

const stage = stageFromArgs();
const isProduction = stage === "prod";

/** Reads a Stripe key from the environment and checks it suits this stage. */
function stripeKeyFromEnv(name: string): string {
  const key = (process.env[name] ?? process.env.STRIPE_SECRET_KEY)?.trim();
  if (!key) throw new Error(`Set ${name} to a restricted Stripe key. See the notes at the top of this script.`);

  const isLiveKey = key.includes("_live_");
  if (isLiveKey !== isProduction) {
    throw new Error(`${name} is a ${isLiveKey ? "live" : "test"} key, which must not be used for the "${stage}" stage.`);
  }
  const isRestricted = key.startsWith("rk_");
  if (!isRestricted && isProduction) {
    throw new Error(`${name} must be a restricted key (rk_live_...) in production, never an unrestricted secret key.`);
  }
  if (!isRestricted) {
    console.warn(`Warning: ${name} is an unrestricted secret key. Fine for a throwaway sandbox; use restricted keys otherwise.`);
  }
  return key;
}

const basketKey = stripeKeyFromEnv("STRIPE_BASKET_KEY");
const paymentKey = stripeKeyFromEnv("STRIPE_PAYMENT_KEY");
const setupKey = stripeKeyFromEnv("STRIPE_SETUP_KEY");

const { StripeWebhookUrl } = await getStackOutputs(stage);
const parameters = secretParameterNames(stage);
const ssm = new SSMClient({});
const stripe = new Stripe(setupKey);

const storeSecret = (name: string, value: string) =>
  ssm.send(new PutParameterCommand({ Name: name, Value: value, Type: "SecureString", Overwrite: true }));

await storeSecret(parameters.basketStripeKey, basketKey);
await storeSecret(parameters.paymentStripeKey, paymentKey);
console.log(`Stored service keys at ${parameters.basketStripeKey} and ${parameters.paymentStripeKey}`);

// Stripe only reveals a webhook signing secret when the endpoint is created,
// so replace any existing endpoint for this URL.
for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
  if (endpoint.url === StripeWebhookUrl) {
    await stripe.webhookEndpoints.del(endpoint.id);
    console.log(`Removed previous webhook endpoint ${endpoint.id}`);
  }
}
const endpoint = await stripe.webhookEndpoints.create({
  url: StripeWebhookUrl,
  enabled_events: WEBHOOK_EVENTS,
  // Events are sent in the same API version the SDK's types describe.
  api_version: Stripe.API_VERSION as Stripe.WebhookEndpointCreateParams.ApiVersion,
  description: `LuxeBaddy ${stage} payment service`,
});
if (!endpoint.secret) throw new Error("Stripe did not return a webhook signing secret");

await storeSecret(parameters.stripeWebhookSecret, endpoint.secret);
console.log(`Registered webhook ${endpoint.id} -> ${StripeWebhookUrl}`);
console.log(`Stored webhook signing secret at ${parameters.stripeWebhookSecret}`);
