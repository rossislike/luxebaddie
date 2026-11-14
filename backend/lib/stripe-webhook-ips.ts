/**
 * The addresses Stripe sends webhooks from. The webhook route accepts calls
 * from these only, as a second layer on top of signature verification.
 *
 * Source: https://stripe.com/files/ips/ips_webhooks.json (fetched 2026-11-14).
 * Stripe announces changes in advance at https://docs.stripe.com/ips. When the
 * list changes, update it here and redeploy; until then Stripe's calls from a
 * new address are refused and retried (Stripe retries for up to three days).
 */
export const STRIPE_WEBHOOK_IPS = [
  "3.18.12.63",
  "3.69.109.8",
  "3.120.168.93",
  "3.130.192.231",
  "13.235.14.237",
  "13.235.122.149",
  "18.211.135.69",
  "35.154.171.200",
  "35.157.207.129",
  "52.15.183.38",
  "54.88.130.119",
  "54.88.130.237",
  "54.187.174.169",
  "54.187.205.235",
  "54.187.216.72",
];
