/**
 * Payment microservice: the only place that talks to Stripe about money received.
 * Composition root - the only file that knows which concrete adapters are used.
 */
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { awsClientDefaults } from "../shared/adapters/aws-clients";
import { createSecretReader } from "../shared/adapters/ssm-secrets";
import { createStripeProvider } from "../shared/adapters/stripe-client";
import { requireEnv } from "../shared/env";
import { eventBridgePublisher } from "./adapters/eventbridge-publisher";
import { paymentHttpHandler } from "./adapters/http";
import { stripePaymentProvider } from "./adapters/stripe-payment-provider";
import { createPaymentService } from "./application/payment-service";

const readSecret = createSecretReader();
const getStripe = createStripeProvider(readSecret, requireEnv("STRIPE_API_KEY_PARAM"));

const paymentService = createPaymentService({
  provider: stripePaymentProvider(getStripe, readSecret, {
    stage: requireEnv("STAGE"),
    webhookSecretParameter: requireEnv("STRIPE_WEBHOOK_SECRET_PARAM"),
  }),
  events: eventBridgePublisher(new EventBridgeClient(awsClientDefaults), requireEnv("EVENT_BUS_NAME")),
});

export const handler = paymentHttpHandler(paymentService);
