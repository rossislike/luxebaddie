# LuxeBaddie roadmap

The living plan for getting LuxeBaddie from idea to a store that takes money and runs itself. Updated as work lands.

**Done means:** a live store that sells products and generates revenue, with day-to-day operations automated.

Legend: `[x]` done · `[~]` in progress · `[ ]` not started · **(you)** needs you, it cannot be done from code

_Last updated: 2026-11-14_

## Where we are

**Phase 1 of 6.** The store's engine is built and running on AWS in a `dev` environment, and it has taken its first test payment: on 2026-11-14 a test card was charged $156.95 through Stripe and an order was created automatically about three seconds later. The storefront runs locally against it. Nothing is public yet and no real money can move.

**Next up:** put the storefront online.

**Waiting on you:** the business decisions in Phase 2. Vendor selection is the long pole: it decides the real catalog, prices, shipping times and return policy.

## Decisions made

| Decision | Choice | Why |
| --- | --- | --- |
| What we sell first | Wigs, weaves (bundles, closures, frontals), lashes | Start with hair; beauty products and accessories come later |
| Fulfillment | Dropship first | Lowest startup cash; stock bestsellers once we know what sells |
| Storefront | Custom site, Stripe for payments | Full control for automation, no monthly platform fee |
| Infrastructure | AWS serverless: Lambda, DynamoDB (single-table design), API Gateway, EventBridge, SQS, CDK, CloudWatch | Modeled on the `aws-microservices` reference; scales to zero cost when idle |
| Launch budget | $1,000 - $5,000 | Samples across the line, a content shoot, real ad testing |
| Already in place | LLC, Stripe account | |

## Phase 1 - Store platform

The machinery: a site customers can buy from and a backend that records what they bought.

- [x] Backend on AWS (`dev`): product, basket, payment and ordering microservices
- [x] Event-driven order pipeline: payment confirmed -> event -> order created, with retries and dead-letter queues so no paid order is lost or duplicated
- [x] Monitoring: alarms, dashboard, request tracing
- [x] Storefront: home, shop, category, product, bag and order confirmation pages
- [x] Placeholder catalog (11 sample products) so everything can be tested
- [x] Your logo is on the site: the crowned portrait is the header and footer logo, the browser tab icon and the phone home-screen icon. The studio sign image has its own section on the home page, and the gold logo image is the preview shown when a link to the store is shared (2026-11-14)
- [x] Automated tests: business rules, plus end-to-end tests against the live `dev` backend
- [x] Connect `dev` to Stripe and complete a full test purchase with a test card (2026-11-14)
- [x] Stripe integration reviewed against Stripe's own best practices: orders created from verified webhooks only, failed pay-later payments handled, webhook restricted to Stripe's addresses, one least-privilege key per service, commits containing keys are blocked
- [x] Database redesigned as a single DynamoDB table (see `backend/DATA-MODEL.md`): no table scans, paged order lists, and orders can be looked up by customer email for support
- [x] Everything on AWS renamed from the old "LuxeBaddy" spelling to "LuxeBaddie". The `dev` environment was rebuilt under the new name, its data moved across, and a fresh test purchase ($189, order LB-BRM57ZTFYA) confirmed it works (2026-11-14)
- [x] `dev` moved to its own Stripe sandbox with one restricted key per service. A test purchase through the real storefront and Stripe Checkout ($19.95, order LB-ADY5PH12N5) confirmed every key has the permissions it needs, with no errors in any service (2026-11-14)
- [x] Old `sk_test_` key that was pasted into chat rolled in the Stripe Dashboard (2026-11-14)
- [ ] Put the storefront online on AWS (S3 + CloudFront) with security headers, rebuilt automatically when the catalog changes
- [ ] Mobile pass on every page (most ad traffic will be on phones)

## Phase 2 - Business setup

Things only the business owner can decide or sign. These can run in parallel with Phase 1.

- [ ] **(you)** Shortlist 3-5 dropship hair vendors and order samples of each core product. Judge hair quality, lace, shedding, packaging and real delivery time
- [ ] **(you)** Pick the vendor(s). Get their price list, shipping times and costs, return terms, and how they take orders (portal, email, API)
- [ ] **(you)** Register the domain (`luxebaddie.com` or the closest available)
- [ ] **(you)** Trademark search for "LuxeBaddie" in beauty and hair (USPTO class 3 and 26) before spending on branding
- [ ] **(you)** Claim the brand handle on Instagram, TikTok, Facebook and Pinterest
- [ ] **(you)** Finish Stripe activation for live payments (business details, bank account). Turn on Afterpay and Klarna in Stripe's payment method settings: pay-later matters at wig prices, and no code change is needed
- [ ] **(you)** Set the public business name and branding in Stripe to LuxeBaddie. The checkout page currently shows "Rumothy LLC" to shoppers
- [ ] **(you)** Secure the Stripe Dashboard login with a passkey or authenticator app rather than SMS codes
- [ ] **(you)** Decide store policies: shipping times, returns and exchanges (worn or opened hair and lashes are normally final sale for hygiene), order cancellation
- [ ] **(you)** Sales tax: confirm with a tax advisor where you must collect. Then in Stripe Tax set the head office address, choose the product tax code for hair goods from Stripe's list, and add a registration for each place you are registered. Only after that do we switch tax collection on; without a registration Stripe collects nothing and gives no warning
- [ ] **(you)** Business bank account and bookkeeping for the LLC, if not already set up
- [ ] Decide whether production runs in this AWS account or a dedicated one for the business

## Phase 3 - Launch readiness

Turning the working engine into a store that is ready for real customers.

- [ ] Replace the placeholder catalog with the real vendor line: names, descriptions, options, prices with healthy margin after vendor cost, shipping, Stripe fees and ad spend
- [ ] Product photography and video (samples from Phase 2), hosted on a CDN
- [ ] Final shipping rates and free-shipping threshold (currently placeholders: $7.95 flat, free over $150)
- [ ] Policy pages: shipping, returns, privacy, terms. Contact page and FAQ
- [ ] Order confirmation and shipping notification emails
- [ ] Fulfillment workflow: see unfulfilled orders, mark as ordered from vendor, add tracking
- [ ] Production environment: restricted live Stripe keys, real domain, data backups on, alarm emails to you
- [ ] Refunds and disputes: keep orders in step when a payment is refunded or charged back in Stripe
- [ ] Tell the shopper when a pay-later payment is declined after checkout (the `CheckoutPaymentFailed` event already exists)
- [ ] Walk through Stripe's go-live checklist
- [ ] SEO basics: titles, descriptions, sitemap, social share images
- [ ] Analytics and ad pixels (Meta, TikTok) with server-side conversion tracking
- [ ] Launch checklist: a real purchase and refund with a live card, on a phone

## Phase 4 - Automation

The goal is a store that runs with you supervising rather than operating. Each automation subscribes to business events (like `CheckoutCompleted`), so they can be added one at a time without touching what already works.

- [ ] Order forwarding: a paid order is sent to the vendor automatically
- [ ] Tracking: vendor tracking numbers flow back and the customer is notified
- [ ] AI customer support: answers order status, shipping, product and care questions by email and chat, escalating to you when unsure
- [ ] AI catalog assistant: drafts product descriptions and SEO copy for new products for your approval
- [ ] Daily owner's report: sales, orders needing attention, ad spend and anything that broke
- [ ] Abandoned checkout recovery: a reminder to shoppers who reached payment but did not finish
- [ ] Refund and return handling workflow

## Phase 5 - Marketing

- [~] Brand kit: logo, colors, voice. Logo is chosen and in use (`images/LuxeBaddie3.jpeg`). Still to do: get the logo from the designer as a vector file (SVG) so it stays sharp at any size, and settle on one emblem, since the gold share image uses a different crown-and-wave mark
- [ ] Product feed for Meta and TikTok shops and catalog ads
- [ ] AI content engine: captions, hooks and ad copy variations from product data and your footage
- [ ] Organic content calendar for TikTok and Instagram Reels (installs, reveals, before/after)
- [ ] Paid ad tests on Meta and TikTok with small daily budgets; scale what converts
- [ ] Creator seeding: send product to micro-influencers for content and reviews
- [ ] Email and SMS list: signup offer, welcome series, launches

## Phase 6 - Grow

- [ ] Customer reviews with photos
- [ ] Bundle deals (bundles + closure, wig + care kit)
- [ ] Stock bestsellers for faster delivery and better margin
- [ ] Customer accounts and order history
- [ ] Expand the line: hair care, beauty products, accessories

## Open questions

- Which vendor(s)? Everything in Phase 3 depends on it.
- Is the brand name clear to use (trademark search)?
- Production AWS account: this one or a dedicated account?
