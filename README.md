<img src="assets/icon.png" width="64" height="64" alt="LuxeBaddie logo">

# LuxeBaddie

An online store for wigs, weaves and lashes, built to run with as little manual work as possible.

**Where things stand and what is next: see [ROADMAP.md](ROADMAP.md).**

## How it fits together

```
 Shopper's browser
   │  static storefront (Next.js export)             web/
   ▼
 API Gateway  ── one REST API, /admin/* routes need IAM-signed requests
   │
   ├─ product  Lambda ──┐                            the catalog
   ├─ basket   Lambda ──┼── one DynamoDB table       the bag; starts Stripe Checkout
   ├─ payment  Lambda ◄── Stripe webhook             confirms payments (Stripe IPs only + signature)
   │      │ publishes CheckoutCompleted
   │      ▼
   │   EventBridge bus ──► order queue (SQS) ──────► ordering Lambda ── same DynamoDB table
   │                  └──► paid-basket queue (SQS) ─► basket Lambda (empties the paid bag)
   └─ ordering Lambda                                order confirmation + fulfillment queue

 CloudWatch: alarms (dead-letter queues, Lambda errors, API 5xx), one dashboard, X-Ray traces
```

A purchase, step by step:

1. The storefront saves the bag through the **basket** service, which prices it from the catalog. The browser never sends prices.
2. Checkout creates a Stripe Checkout session. Stripe hosts the payment page, so card details never touch this system.
3. Stripe calls the **payment** service's webhook. It verifies the signature, reads the session back from Stripe to confirm it is paid, and publishes a `CheckoutCompleted` event.
4. EventBridge copies the event to each subscriber's queue. **Ordering** writes the order; **basket** empties the paid bag.
5. The confirmation page reads the order back by its checkout session id.

New automations (confirmation emails, forwarding orders to vendors, AI workflows) subscribe to events with their own queue. Nothing upstream changes.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/contracts` | The shared language: product, basket, order and event shapes (zod schemas). Used by both sides. |
| `backend/lib` | AWS infrastructure as code (CDK): database, microservices, API gateway, event bus, queues, monitoring. |
| `backend/src/<service>` | One folder per microservice, each laid out as ports and adapters (below). |
| `backend/src/table` | The single table's key formats and item mappers. The only place that builds a key. |
| `backend/DATA-MODEL.md` | The data model: entities, keys, and the request behind every access pattern. |
| `backend/scripts` | Seed the catalog, connect a stage to Stripe. |
| `web` | The storefront. |

Each microservice keeps business rules away from AWS and Stripe details:

| Folder | Holds | May depend on |
| --- | --- | --- |
| `domain/` | Pure business rules (pricing, shipping, order numbers) | nothing |
| `application/` | Use cases, and `ports.ts`: the interfaces they need from the outside world | `domain/` |
| `adapters/` | DynamoDB, Stripe, EventBridge, API Gateway and SQS code implementing or calling the ports | `application/`, `domain/` |
| `index.ts` | Composition root: wires adapters into use cases and exports the Lambda handler | everything |

Use cases are tested with in-memory fakes, so the business rules run without AWS or Stripe.

## Design decisions worth knowing

- **Consistency.** An order appears a second or two after payment (eventual consistency). The confirmation page waits for it. Nothing needs a transaction across services.
- **No lost or duplicate orders.** Stripe redelivers a webhook until it gets a success response, queues retry failed messages, and anything that still fails lands in a dead-letter queue with an alarm. Order numbers are derived from the checkout session id, so the same payment processed twice produces the same single order.
- **Ordering of events** does not matter: every checkout is independent.
- **Remote calls** all have timeouts and a capped number of retries with backoff and jitter (AWS SDK, Stripe SDK, and the storefront's API client). Only idempotent calls are retried.
- **No circuit breaker.** The only third-party dependency on a request path is Stripe at checkout. It fails fast (4 second timeout) and Lambda has no shared thread pool to exhaust, so a breaker would add state without adding protection. Revisit if synchronous service-to-service calls are introduced.
- **One DynamoDB table holds everything** (single-table design): products, baskets and orders, arranged so every read is a single-item lookup or one contiguous range, never a scan. The model is documented in [backend/DATA-MODEL.md](backend/DATA-MODEL.md); read it before touching keys.
- **Services still own their data.** IAM lets each Lambda touch only items whose key starts with its own prefix. The basket service has read-only access to products for pricing, which avoids a synchronous call to the product service.
- **Secrets** (Stripe keys) live encrypted in SSM Parameter Store, never in code, environment variables or templates. A pre-commit hook (`.githooks/pre-commit`) refuses commits that contain a Stripe key, and CI scans every commit for leaked keys of any kind.
- **When a service must both save data and publish an event** (for example a future `OrderPlaced`), publish from the table's DynamoDB Stream rather than making two separate calls, so the two can never disagree.

## Stripe

- **Stripe Checkout, hosted by Stripe.** Card details never touch this system. Payment methods are not hard-coded: Stripe shows whichever ones are enabled in the Dashboard (cards, Apple Pay, Link, Afterpay, Klarna...) that suit each shopper.
- **Orders come from webhooks, never from the confirmation page.** A shopper can pay and close the tab. The payment service handles `checkout.session.completed` and `checkout.session.async_payment_succeeded` (creating the order only once the session is actually paid) and `checkout.session.async_payment_failed` (published as `CheckoutPaymentFailed`).
- **Two layers protect the webhook.** API Gateway only accepts calls to it from Stripe's published addresses (`backend/lib/stripe-webhook-ips.ts`), and the payment service then verifies Stripe's signature.
- **Least-privilege keys.** Each service reads its own restricted Stripe key and nothing else:

  | Key | Used by | Stripe permissions |
  | --- | --- | --- |
  | `STRIPE_BASKET_KEY` | basket service | Checkout Sessions: Write |
  | `STRIPE_PAYMENT_KEY` | payment service | Checkout Sessions: Read, Products: Read |
  | `STRIPE_SETUP_KEY` | setup script only, never stored | Webhook Endpoints: Write |

  These permission lists were confirmed with a full test purchase on `dev` (2026-11-14). If a new Stripe call later returns 403, add the permission Stripe names in the error to that service's key.
- **Environments.** Use a dedicated Stripe sandbox per environment rather than the shared test mode. The setup script refuses test keys for `prod`, live keys for anything else, and unrestricted keys for `prod`.
- **Sales tax is off** until Stripe Tax is fully set up (`stripeAutomaticTax` in `backend/lib/stage-config.ts`). Turning it on without an active tax registration collects nothing and reports no error.
- **Testing a payment:** card `4242 4242 4242 4242`, any future expiry, any security code.

## Working on it

Prerequisites: Node 22+, pnpm, AWS credentials for the account, and the account bootstrapped for CDK.

```bash
pnpm install

# Backend
pnpm deploy:dev          # deploy the dev stage to AWS
pnpm seed:dev            # load the placeholder catalog
pnpm test                # unit tests (no AWS needed)
pnpm test:e2e            # end-to-end tests against the deployed dev stage (wait a minute after a deploy)

# Look at real data by access pattern (run without a pattern to list them)
pnpm --filter @luxebaddie/backend db dev catalog wigs
pnpm --filter @luxebaddie/backend db dev customer someone@example.com

# Connect the dev stage to Stripe, once (restricted keys from a Stripe sandbox, see "Stripe" above)
STRIPE_BASKET_KEY=rk_test_... STRIPE_PAYMENT_KEY=rk_test_... STRIPE_SETUP_KEY=rk_test_... \
  pnpm --filter @luxebaddie/backend stripe:setup:dev

# Storefront
cp web/.env.example web/.env.local   # set NEXT_PUBLIC_API_URL to the stack's ApiUrl output
pnpm dev                             # http://localhost:3000
pnpm build                           # static site in web/out
```

### Getting a change into `main`

Nobody pushes to `main` directly. Every change goes through a short-lived branch and a pull request:

```bash
git switch -c my-change      # branch off main
# ...commit...
git push -u origin my-change
gh pr create                 # CI starts on its own
```

CI (`.github/workflows/ci.yml`) runs on every pull request and needs no AWS or Stripe credentials:

| Check | What it runs | Run it locally |
| --- | --- | --- |
| Typecheck | TypeScript across the storefront, backend and contracts | `pnpm typecheck` |
| Lint | ESLint on the storefront | `pnpm lint` |
| Unit tests | Vitest for the storefront and backend | `pnpm test` |
| CDK build | Bundles the Lambdas and builds the `dev` CloudFormation template | `pnpm --filter @luxebaddie/backend synth` |
| Secret scan | gitleaks over every commit, with the rules in `.gitleaks.toml` | `gitleaks git .` |

A ruleset on `main` blocks the merge until the "CI passed" check is green, and blocks direct pushes, force pushes and deleting the branch. It applies to everyone, repository admins included. The ruleset is kept in `.github/rulesets/main.json`; GitHub does not read that file, so after editing it apply it with:

```bash
gh api repos/rossislike/luxebaddie/rulesets --jq '.[] | select(.name == "main") | .id'   # find the ruleset id
gh api --method PUT repos/rossislike/luxebaddie/rulesets/<id> --input .github/rulesets/main.json
```

Admin routes (`/admin/*`) accept only requests signed with AWS credentials. They cover the catalog, the fulfillment queue (`/admin/order`), a single order, and one customer's orders by email (`/admin/customer/{email}/order`); order lists are paged with `?limit=` and `?cursor=`. `backend/scripts/lib/aws.ts` has a ready-made signed `fetch`.

Operations: the `LuxeBaddie-dev` CloudWatch dashboard shows traffic, errors and queue health. To receive alarm emails, set `alarmEmail` for the stage in `backend/lib/stage-config.ts`.
