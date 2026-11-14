export type StageConfig = {
  stage: string;
  /**
   * Storefronts other than the stage's own hosted one (lib/storefront-hosting.ts)
   * that may call the API and be returned to after checkout. For local
   * development; a production stage leaves this empty. No trailing slashes.
   */
  localStorefrontOrigins: string[];
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
    localStorefrontOrigins: ["http://localhost:3000"],
    retainData: false,
    stripeAutomaticTax: false,
  },
  // prod is added when the domain is registered (see ROADMAP.md). It must set
  // retainData: true, leave localStorefrontOrigins empty, and serve the
  // storefront from the real domain.
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
    basketStripeKey: `/luxebaddie/${stage}/stripe/basket-api-key`,
    /** Restricted key for the payment service. Stripe permissions: Checkout Sessions (read), Products (read). */
    paymentStripeKey: `/luxebaddie/${stage}/stripe/payment-api-key`,
    stripeWebhookSecret: `/luxebaddie/${stage}/stripe/webhook-secret`,
  };
}
