export type StageConfig = {
  stage: string;
  /** Where Stripe sends shoppers after checkout. No trailing slash. */
  storefrontUrl: string;
  /** Browser origins allowed to call the API (CORS). */
  allowedOrigins: string[];
  /** Keep tables (and their data) if the stack is deleted, and enable point-in-time recovery. */
  retainData: boolean;
  /**
   * Collect sales tax at checkout with Stripe Tax. Only turn on after Stripe Tax
   * has a head office address, a product tax code, and an active registration
   * for every place you must collect in. Without a registration Stripe collects
   * no tax and reports no error.
   */
  stripeAutomaticTax: boolean;
  /** Receives CloudWatch alarm emails. Optional. */
  alarmEmail?: string;
};

const stages: Record<string, StageConfig> = {
  dev: {
    stage: "dev",
    storefrontUrl: "http://localhost:3000",
    allowedOrigins: ["http://localhost:3000"],
    retainData: false,
    stripeAutomaticTax: false,
  },
  // prod is added when the domain is registered (see ROADMAP.md). It must set
  // retainData: true and use the live storefront URL.
};

export function stageConfigFor(stage: string): StageConfig {
  const config = stages[stage];
  if (!config) {
    throw new Error(`Unknown stage "${stage}". Configured stages: ${Object.keys(stages).join(", ")}`);
  }
  return config;
}

/**
 * SSM Parameter Store paths for the stage's Stripe secrets, written by
 * scripts/stripe-setup.ts. Each service has its own restricted Stripe key with
 * only the permissions it needs, and can read only its own parameter.
 */
export function secretParameterNames(stage: string) {
  return {
    /** Restricted key for the basket service. Stripe permission: Checkout Sessions (write). */
    basketStripeKey: `/luxebaddy/${stage}/stripe/basket-api-key`,
    /** Restricted key for the payment service. Stripe permissions: Checkout Sessions (read), Products (read). */
    paymentStripeKey: `/luxebaddy/${stage}/stripe/payment-api-key`,
    stripeWebhookSecret: `/luxebaddy/${stage}/stripe/webhook-secret`,
  };
}
