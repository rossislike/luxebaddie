export type StageConfig = {
  stage: string;
  /**
   * Storefronts other than the stage's own hosted one (lib/luxebaddie-stack.ts)
   * that may call the API and be returned to after checkout. For local
   * development; a production stage leaves this empty. No trailing slashes.
   */
  localStorefrontOrigins: string[];
  /**
   * The same for the back office: addresses other than the hosted one
   * (lib/luxebaddie-stack.ts) that may call the API and that an owner may be
   * returned to after signing in. For local development; a production stage
   * leaves this empty. No trailing slashes.
   */
  localBackOfficeOrigins: string[];
  /** Keep tables (and their data) if the stack is deleted, and enable point-in-time recovery. */
  retainData: boolean;
  /**
   * Collect sales tax at checkout with Stripe Tax. Only turn on after Stripe Tax
   * has a head office address, a product tax code, and an active registration
   * for every place you must collect in. Without a registration Stripe collects
   * no tax and reports no error.
   */
  stripeAutomaticTax: boolean;
  /**
   * Let GitHub Actions run the end-to-end tests against this stage after each
   * deployment (lib/end-to-end-test-access.ts). The tests create and remove
   * products and orders, so this stays off for production.
   */
  endToEndTestAccess: boolean;
  /** Receives CloudWatch alarm emails. Optional. */
  alarmEmail?: string;
};

const stages: Record<string, StageConfig> = {
  dev: {
    stage: "dev",
    localStorefrontOrigins: ["http://localhost:3000"],
    localBackOfficeOrigins: ["http://localhost:3001"],
    retainData: false,
    stripeAutomaticTax: false,
    endToEndTestAccess: true,
  },
  // prod is added when the domain is registered (see ROADMAP.md). It must set
  // retainData: true, leave localStorefrontOrigins and localBackOfficeOrigins empty, turn
  // endToEndTestAccess off, and serve the storefront from the real domain.
};

export function stageConfigFor(stage: string): StageConfig {
  const config = stages[stage];
  if (!config) {
    throw new Error(`Unknown stage "${stage}". Configured stages: ${Object.keys(stages).join(", ")}`);
  }
  return config;
}

/** The CloudFormation stacks that make up a stage. */
export function stackNames(stage: string) {
  return {
    /** The store itself: backend, storefront hosting and monitoring (lib/luxebaddie-stack.ts). */
    store: `LuxeBaddie-${stage}`,
    /** The roles GitHub Actions deploys the store with (lib/deploy-access-stack.ts). */
    deployAccess: `LuxeBaddie-${stage}-DeployAccess`,
  };
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
