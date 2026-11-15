<img src="assets/icon.png" width="64" height="64" alt="LuxeBaddie logo">

# LuxeBaddie

An online store for wigs, weaves and lashes, built to run with as little manual work as possible.

**Where things stand and what is next: see [ROADMAP.md](ROADMAP.md).**

## How it fits together

```
 Shopper's browser
   │  static storefront (Next.js export)             web/
   ▼
 CloudFront ── HTTPS, security headers, caching ──► private S3 bucket (the built site)
   │
   │  the pages call the API from the browser
   ▼
 API Gateway  ── one REST API. Back-office routes need an IAM-signed request (/admin/*)
   │             or the signed-in owner's token (/backoffice/*), checked against Cognito
   │
   ├─ product  Lambda ──┐                            the catalog
   ├─ basket   Lambda ──┼── one DynamoDB table       the bag; starts Stripe Checkout
   ├─ payment  Lambda ◄── Stripe webhook             confirms payments (Stripe IPs only + signature)
   │      │ publishes CheckoutCompleted
   │      ▼
   │   EventBridge bus ──► order queue (SQS) ──────► ordering Lambda ── same DynamoDB table
   │                  └──► paid-basket queue (SQS) ─► basket Lambda (empties the paid bag)
   └─ ordering Lambda                                order confirmation + fulfillment queue

 Keeping the storefront current:
   product saved or removed ─► table's change stream ─► change relay Lambda ─► CatalogChanged on the bus
   CatalogChanged, or a finished deployment ─► rebuild queue (SQS) ─► storefront Lambda ─► CodeBuild
   CodeBuild: builds the site from the catalog ─► uploads to S3 ─► clears CloudFront's cache

 CloudWatch: alarms (dead-letter queues, Lambda errors, API and storefront 5xx, failed builds), one dashboard, X-Ray traces

 Getting changes there:
   pull request ─► CI checks, and a comment showing what it would change on AWS
   merge to main ─► GitHub Actions ─► deploys dev (CDK) ─► waits for the rebuilt storefront ─► end-to-end tests
```

A purchase, step by step:

1. The storefront saves the bag through the **basket** service, which prices it from the catalog. The browser never sends prices.
2. Checkout creates a Stripe Checkout session. Stripe hosts the payment page, so card details never touch this system.
3. Stripe calls the **payment** service's webhook. It verifies the signature, reads the session back from Stripe to confirm it is paid, and publishes a `CheckoutCompleted` event.
4. EventBridge copies the event to each subscriber's queue. **Ordering** writes the order; **basket** empties the paid bag.
5. The confirmation page reads the order back by its checkout session id.

New automations (confirmation emails, forwarding orders to vendors, AI workflows) subscribe to events with their own queue. Nothing upstream changes.

A catalog change, step by step:

1. An admin saves or removes a product through the **product** service. That is the only thing the product service does: it does not publish anything itself.
2. DynamoDB records the write in the table's change stream. The product service's **change relay** reads it and publishes `CatalogChanged`.
3. The event lands in the storefront's rebuild queue. The **storefront** service collects what arrives within 30 seconds and starts one build for the lot.
4. The build reads the catalog from the API, generates every page, uploads the site and clears CloudFront's cache. About two minutes after the save, the change is live.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/contracts` | The shared language: product, basket, order and event shapes (zod schemas). Used by both sides. |
| `backend/lib` | AWS infrastructure as code (CDK): database, microservices, API gateway, event bus, queues, storefront hosting and build, monitoring. |
| `backend/src/<service>` | One folder per microservice, each laid out as ports and adapters (below). |
| `backend/src/table` | The single table's key formats and item mappers. The only place that builds a key. |
| `backend/DATA-MODEL.md` | The data model: entities, keys, and the request behind every access pattern. |
| `backend/scripts` | Seed the catalog, connect a stage to Stripe, wait for the storefront to catch up with a deployment. |
| `.github/workflows` | The checks on every pull request, the infrastructure comparison, and the deploy pipeline. |
| `docs` | The domain model in UML: class, sequence, activity and use case diagrams for each bounded context. Start at [docs/README.md](docs/README.md). The deployed AWS pieces and their connections to Stripe are in [docs/infrastructure-diagrams.md](docs/infrastructure-diagrams.md). |
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
- **Secrets** (Stripe keys) live encrypted in SSM Parameter Store, never in code, environment variables, templates or GitHub. A pre-commit hook (`.githooks/pre-commit`) refuses commits that contain a Stripe key, and CI scans every commit for leaked keys of any kind.
- **When a service must both save data and publish an event**, it only saves, and the event is published from the table's change stream (`backend/lib/change-feed.ts`), so the two can never disagree. `CatalogChanged` works this way today; a future `OrderPlaced` should too.
- **One storefront build at a time.** Two builds running together could finish in the wrong order and leave the older catalog live. The build project refuses a second build; the request waits in the queue and is retried, which also guarantees a build that starts after the last change.

## Storefront hosting

Each stage has its own hosted storefront. Its address is the stack's `StorefrontUrl` output; `dev` is at https://d2dc32zxkhz4om.cloudfront.net until there is a domain.

- **Private bucket, public CDN.** The site's files sit in an S3 bucket nobody can read directly. CloudFront is the only reader (origin access control, with a bucket policy naming this one distribution), so every request gets HTTPS and the security headers.
- **Published by a build, never by hand.** `backend/lib/storefront-build.ts` defines a CodeBuild project that builds the site and uploads it. It runs when the catalog changes and when a deployment finishes, from the source that was deployed. There is no "upload the site" command to forget.
- **Clean addresses.** The export is one file per page (`/shop.html`); a small CloudFront Function (`backend/lib/storefront-page-router.js`) maps `/shop` to it. Unknown addresses get the 404 page.
- **Caching.** Files with a content hash in their name are cached for a year. Pages are revalidated by the browser on every visit and cached by CloudFront until the next publish clears it.
- **Security headers**, added by CloudFront to every response, including errors:

  | Header | Value | What it does |
  | --- | --- | --- |
  | `Strict-Transport-Security` | two years, including subdomains | Browsers refuse plain HTTP after the first visit |
  | `Content-Security-Policy` | `frame-ancestors 'none'` | The store cannot be framed by another site |
  | `X-Frame-Options` | `DENY` | The same, for old browsers |
  | `X-Content-Type-Options` | `nosniff` | Browsers never guess a file's type |
  | `Referrer-Policy` | `strict-origin-when-cross-origin` | Other sites learn the shopper came from the store, not which page |
  | `Permissions-Policy` | camera, microphone, location off | Nothing on the site can use them |
  | `Cross-Origin-Opener-Policy` | `same-origin` | Pages opened from the store get no handle back to it |

- **The rest of the Content-Security-Policy is inside each page.** A static site cannot use per-request nonces, and Next.js puts inline scripts in every page. So the build (`web/scripts/content-security-policy.mjs`) writes a `<meta>` policy into each page listing the hash of exactly the inline scripts that page shipped with. Scripts run only from the site's own files or that list; `'unsafe-inline'` and `'unsafe-eval'` are never allowed for scripts. The browser may connect only to the site and the stage's API. If a third-party script is added later (an ad pixel, analytics), its origin has to be added there.
- **Logs.** CloudFront access logs go to a second private bucket (30 days in `dev`), without query strings, referrers or cookies: the order confirmation address contains the checkout session id.
- **What it costs.** With no traffic, close to nothing: there is no fixed monthly fee for CloudFront, S3 or CodeBuild. CodeBuild's free tier covers 100 build minutes a month on this build size and a build takes about a minute ([CodeBuild pricing](https://aws.amazon.com/codebuild/pricing/)). Each publish uses one of CloudFront's 1,000 free cache-clearing paths a month ([CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)). Beyond that, CloudFront charges for requests and data transferred, and S3 for a few megabytes of storage ([S3 pricing](https://aws.amazon.com/s3/pricing/)).
- **Not yet in place, by choice:** a custom domain and certificate (waiting on the domain), and a web application firewall. Both are production decisions; see ROADMAP.md.

To rebuild the storefront by hand (for example after a failed build), start the project named in the `StorefrontBuildProject` output from the CodeBuild console. If a build is already running, CodeBuild refuses, which is the intended behavior.

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
pnpm test                # unit tests (no AWS needed)
pnpm seed:dev            # load the placeholder catalog
pnpm test:e2e            # end-to-end tests against the deployed dev stage, API and hosted storefront (takes a few minutes)

# Deploying by hand. Merging to main does all of this for you (see "After the merge" below);
# these are for trying a branch on dev before it is merged. The next merge replaces it.
pnpm deploy:dev                                         # deploy the dev stage to AWS (backend and storefront hosting)
pnpm --filter @luxebaddie/backend storefront:wait:dev   # wait until the storefront has been rebuilt from what was just deployed
pnpm --filter @luxebaddie/backend diff:dev              # what the branch would change on AWS, without deploying

# Look at real data by access pattern (run without a pattern to list them)
pnpm --filter @luxebaddie/backend db dev catalog wigs
pnpm --filter @luxebaddie/backend db dev customer someone@example.com

# Connect the dev stage to Stripe, once (restricted keys from a Stripe sandbox, see "Stripe" above)
STRIPE_BASKET_KEY=rk_test_... STRIPE_PAYMENT_KEY=rk_test_... STRIPE_SETUP_KEY=rk_test_... \
  pnpm --filter @luxebaddie/backend stripe:setup:dev

# Storefront, locally (the hosted one needs none of this)
cp web/.env.example web/.env.local   # set NEXT_PUBLIC_API_URL to the stack's ApiUrl output
pnpm dev                             # http://localhost:3000
pnpm build                           # static site in web/out, with each page's Content-Security-Policy
```

A checkout started from `localhost:3000` returns to `localhost:3000`; one started from the hosted storefront returns there. The API accepts browser calls from those two origins only.

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

A second workflow (`.github/workflows/infrastructure-diff.yml`) comments on the pull request with what merging it would change on AWS: the resources it would add, remove or modify in `dev`, compared with what is deployed there now. The comment is updated as the pull request changes. It is there to be read before merging; it does not block the merge.

A ruleset on `main` blocks the merge until the "CI passed" check is green, and blocks direct pushes, force pushes and deleting the branch. It applies to everyone, repository admins included. The ruleset is kept in `.github/rulesets/main.json`; GitHub does not read that file, so after editing it apply it with:

```bash
gh api repos/rossislike/luxebaddie/rulesets --jq '.[] | select(.name == "main") | .id'   # find the ruleset id
gh api --method PUT repos/rossislike/luxebaddie/rulesets/<id> --input .github/rulesets/main.json
```

### After the merge: automatic deploys to `dev`

Merging is the deploy. `.github/workflows/deploy.yml` runs on every push to `main`:

| Stage | What it does |
| --- | --- |
| Checks | The same checks as the pull request, on the merged result |
| Deploy to dev | Deploys the backend and the storefront's hosting with CDK, then waits until the storefront has been rebuilt from the new source and is live |
| End-to-end tests on dev | Runs `pnpm test:e2e` against the live API and storefront |

Runs go one at a time, and a run that has started is never cancelled. To run the pipeline again without a new commit, use "Run workflow" on the Deploy workflow in the Actions tab, or `gh workflow run deploy.yml`.

When something fails:

- **A check fails:** nothing is deployed.
- **The deployment fails:** CloudFormation puts the previous version back, and the storefront is rebuilt from it.
- **The storefront build fails:** the deploy job fails after waiting 15 minutes. The backend is on the new version and the previous site stays up.
- **An end-to-end test fails:** `dev` stays on the new version, which is now known to be broken. Nothing is rolled back for you: fix it with another pull request.

**How GitHub gets into AWS.** No AWS key is stored in GitHub. For each job, GitHub issues a short-lived token saying which repository the job belongs to and which branch, environment or pull request it runs for. AWS swaps that token for credentials that expire within the hour, and only for a role whose conditions the run meets exactly (this is OpenID Connect, OIDC). There are three roles, one per job:

| Role | Which runs can use it | What it can do |
| --- | --- | --- |
| `luxebaddie-dev-github-preview` | Pull requests from branches of this repository | Read `dev`'s CloudFormation template. Nothing else |
| `luxebaddie-dev-github-deploy` | Jobs in the `dev` GitHub environment, which only accepts the `main` branch | Deploy, through the roles `cdk bootstrap` created, and read the stack's status |
| `luxebaddie-dev-github-e2e` | Jobs on the `main` branch | What the end-to-end tests do: call the admin routes, publish a `CheckoutCompleted` event, delete the test orders, and create, sign in as and delete a throwaway owner |

Worth knowing:

- **Whoever can merge to `main` can change anything in the AWS account.** CDK deploys through a CloudFormation role with administrator rights, which is its standard setup. The ruleset on `main` is what guards it. Production should not share that: see the production account decision in ROADMAP.md.
- **Stripe is not part of the pipeline.** No workflow reads or writes a Stripe key, and none of the three roles is allowed to read one. Connecting a stage to Stripe stays the manual step above.
- **The workflow logs are public**, because the repository is. The AWS account number is stored as a GitHub secret (`AWS_ACCOUNT_ID`) so GitHub masks it in the logs. It is not a credential, and it is the only AWS detail GitHub holds.
- **Pull requests from forks and from Dependabot get no infrastructure comment.** GitHub gives them no way to sign in to AWS, which is the point.

The pipeline for a stage is set up once. For `dev` this is done; the steps are here for the next stage, or for rebuilding this one:

```bash
# 1. AWS: trust GitHub's token service. Once per AWS account; skip it if the first command already lists it.
aws iam list-open-id-connect-providers
aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com

# 2. AWS: the deploy and preview roles (backend/lib/deploy-access-stack.ts). No workflow deploys this stack.
pnpm --filter @luxebaddie/backend deploy-access:dev

# 3. GitHub: the environment the deploy job runs in, open to the main branch only
gh api --method PUT repos/rossislike/luxebaddie/environments/dev --input - \
  <<< '{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}'
gh api --method POST repos/rossislike/luxebaddie/environments/dev/deployment-branch-policies -f name=main -f type=branch

# 4. GitHub: the AWS account number, so workflows can name the roles (it asks for the value)
gh secret set AWS_ACCOUNT_ID
```

The roles only accept this repository under its current name and owner (`backend/lib/github-actions.ts`). After renaming or transferring it, update the value there and repeat step 2, and deploy the stage once by hand for the test role.

### The back-office routes and who gets in

The back-office functions cover the catalog, the fulfillment queue (`/order`), a single order, and one customer's orders by email (`/customer/{email}/order`); order lists are paged with `?limit=` and `?cursor=`. Each one is served under two prefixes, and API Gateway checks the caller before any Lambda runs:

| Prefix | Who gets in | Used by |
| --- | --- | --- |
| `/admin/*` | Requests signed with AWS credentials that are allowed to invoke the route | Scripts, automation and the end-to-end tests. `backend/scripts/lib/aws.ts` has a ready-made signed `fetch` |
| `/backoffice/*` | Requests carrying the sign-in token of an owner (`Authorization: Bearer <ID token>`) | The back-office site |

A service declares a back-office route once (`backOfficeRoutes` in `backend/src/shared/adapters/api-gateway.ts`) and the API adds it under both prefixes (`addBackOfficeRoute` in `backend/lib/apigateway.ts`). `backend/test/back-office-routes.ts` lists every one of them: a unit test fails if the API and that list disagree, and the end-to-end tests check that each is refused without a sign-in.

### Back-office sign-in

The owner signs in with Amazon Cognito (`backend/lib/owner-sign-in.ts`). Cognito keeps the password and runs the sign-in; nothing in this repository sees either.

- **By invitation only.** There is no way to register. An account exists because someone with access to the AWS account created it.
- **Two steps, every time.** The password, then a six-digit code from an authenticator app (1Password, Google Authenticator, Authy and the like). Text-message and email codes are switched off.
- **Sessions end.** A sign-in lasts 12 hours. The API accepts each token for 15 minutes; the back office swaps it for a fresh one in the background until the 12 hours are up.
- **Sign out everywhere**, for a lost phone or laptop: `aws cognito-idp admin-user-global-sign-out --user-pool-id <OwnerUserPoolId> --username <email>`. No new tokens are issued from that moment, and the ones already issued stop working within 15 minutes.
- **A lost authenticator** cannot be reset by the owner alone, on purpose: an email inbox must not be enough to get in. Delete the account (`aws cognito-idp admin-delete-user ...`) and invite the owner again. The account holds no data, so nothing is lost.
- **Forgotten password:** reset by email from the sign-in page. The authenticator code is still required afterwards.

The sign-in pages and the invitation command arrive with the back-office site (ROADMAP.md). Until then the user pool exists, has no members, and the `/backoffice/*` routes refuse everyone.

Operations: the `LuxeBaddie-dev` CloudWatch dashboard shows traffic, errors, queue health, storefront requests and storefront builds. A failed storefront build raises an alarm: the site stays up on the previous version, but is missing whatever changed. To receive alarm emails, set `alarmEmail` for the stage in `backend/lib/stage-config.ts`.
