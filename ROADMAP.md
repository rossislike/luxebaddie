# LuxeBaddie roadmap

The living plan for getting LuxeBaddie from idea to a store that takes money and runs itself. Updated as work lands.

**Done means:** a live store that sells products and generates revenue, with day-to-day operations automated.

Legend: `[x]` done · `[~]` in progress · `[ ]` not started · **(you)** needs you, it cannot be done from code

_Last updated: 2026-11-15_

## Where we are

**Phase 1 of 6.** The store's engine is built and running on AWS in a `dev` environment, and it has taken its first test payment: on 2026-11-14 a test card was charged $156.95 through Stripe and an order was created automatically about three seconds later. The storefront is now online too, at a temporary address: https://d2dc32zxkhz4om.cloudfront.net. It shows the placeholder catalog, runs on Stripe's test mode, and no real money can move. It is reachable by anyone who has the link, but nothing points to it.

Changes now publish themselves: merging a change puts it live on `dev` and tests it there, with nobody running a command.

The back office is under construction. It is online at its own address, https://d318grcpgtla6f.cloudfront.net, behind a sign-in: an owner account by invitation only, with an authenticator-app code every time. Orders can be worked there from payment to delivery, and the catalog can be managed there: no script is needed any more.

**Next up:** photo upload for products, then the activity log.

**Waiting on you:** the business decisions in Phase 2. Vendor selection is the long pole: it decides the real catalog, prices, shipping times and return policy. Registering the domain is what turns the temporary storefront address into `luxebaddie.com`.

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

The machinery: a site customers can buy from, a backend that records what they bought, and a back office to run it from.

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
- [x] Automatic checks on every change (GitHub Actions): typecheck, lint, unit tests, a CDK build and a scan for leaked keys run on every pull request, and nothing merges to `main` until they pass. Work moves from committing straight to `main` to short-lived branches and pull requests (2026-11-14)
- [x] Storefront online on AWS (S3 + CloudFront) at https://d2dc32zxkhz4om.cloudfront.net (2026-11-14):
  - Served over HTTPS only, from a private bucket that only the CDN can read
  - Security headers on every page, and each page lists exactly which scripts may run on it, so injected scripts are blocked by the browser
  - Rebuilds itself when the catalog changes: add, edit or remove a product and the site is up to date a few minutes later, with nobody deploying anything. It also rebuilds after every deployment
  - A failed rebuild raises an alarm and leaves the previous version of the site up
  - Checked on the live site: browsing, adding to the bag and reaching Stripe's checkout all work. A full paid test purchase through the hosted site has not been repeated yet
- [x] Diagrams of how the store works (`docs/`): what the business concepts are, who can do what, and how a purchase and a catalog change flow through the system, step by step. Drawn from the code, so they show what is built, with planned features marked as planned (2026-11-14)
- [x] Infrastructure diagrams (`docs/infrastructure-diagrams.md`): every AWS piece the store runs on, how they connect, where the Stripe keys are kept and who can read them, what happens when something fails, and how changes get deployed. Pieces that are planned but not built are listed separately (2026-11-14)
- [x] Automatic deploys to `dev` (GitHub Actions + CDK) (2026-11-15):
  - Merging to `main` re-runs the checks, deploys the backend and the storefront, waits until the rebuilt storefront is actually live, then runs the end-to-end tests against it. One deploy at a time, in order
  - GitHub signs in to AWS with a short-lived role (OIDC), so no AWS keys are stored in GitHub. There are three roles, each usable by one kind of job only: one to deploy (from `main` only), one to run the tests, and one that lets a pull request look at what is deployed and nothing more
  - Each pull request gets a comment showing what infrastructure it would change
  - Stripe setup stays a manual, once-per-environment step, so Stripe keys never pass through the pipeline. None of the pipeline's roles can read a Stripe key
  - If a deploy fails, AWS puts the previous version back. If the tests fail afterwards, nothing is undone automatically: the run shows red and the fix is another change
  - Good to know: anything merged to `main` can change anything in this AWS account, which is how the deploy tool works by default. The rule that every change needs a passing pull request is the guard. This is one more reason to give production its own AWS account (see Phase 2)
- [x] Mobile pass on every page (most ad traffic will be on phones) (2026-11-15):
  - Checked in a real browser at four phone sizes, from the smallest (320 wide) to the largest (430 wide), plus a tablet and a desktop: home, shop, the three category pages, product pages, the bag (empty and full), the order confirmation page and the "page not found" page
  - Improved: nothing scrolls sideways any more, the top bar fits on one row and takes up less of the screen, product names in the grid no longer break one word per line, the price and "Add to bag" sit higher on product pages, and every link and button is easy to hit with a thumb. Desktop looks the same as before
- [ ] Repeat a full paid test purchase through the hosted storefront address. Browsing, the bag and reaching Stripe's checkout are verified there; paying is not

### Back office

Where you run the store: a private site, behind a sign-in, for managing products and working orders. None of it waits on a business decision, so it can be built now.

- [x] The back-office functions exist behind the scenes: list, add, replace and remove products, see the queue of unfulfilled orders, look up an order by number, and list a customer's orders by email. They can only be reached by script, with AWS credentials
- [x] Owner sign-in, using Amazon Cognito (AWS's sign-in service) rather than anything home-made (2026-11-15):
  - [x] Accounts by invitation only. There is no way to register, and an attempt to is refused
  - [x] A second step at every sign-in: a six-digit code from an authenticator app. Text-message and email codes are switched off
  - [x] Sessions expire after 12 hours, and you can sign out everywhere if a device is lost. That takes full effect within 15 minutes
  - [x] The back-office functions accept the signed-in owner. The signed requests that scripts and the automated tests use keep working
  - [x] Tested on `dev` after every deployment: a visitor who is not signed in is refused by every back-office function, a made-up sign-in is refused too, and a signed-in owner gets in
  - [x] Tested on `dev` after every deployment: a visitor who is not signed in never sees a back-office screen. The pages they can fetch hold one line, "Taking you to sign-in", and no store data
  - [x] You sign in on a page Amazon hosts, so your password is never typed into our own site. Signing out ends the session there too, so the next visit asks for the password and the code again
  - Not included: signing in with a passkey (fingerprint or face). Cognito supports it and it can be added later; the authenticator app covers the requirement
- [x] Back-office site at its own address, separate from the shop: https://d318grcpgtla6f.cloudfront.net (2026-11-15):
  - Not linked from the shop, and search engines are told three ways not to list it
  - The same security headers as the storefront, checked side by side after every deployment
  - Published the same way as the storefront: rebuilt on its own after every deployment, and a failed rebuild raises an alarm and leaves the previous version up
  - It opens on a home page showing how many orders are waiting and how many products are for sale or in draft. The screens for working orders and managing the catalog are the next items
- [ ] **(you)** Get your back-office account. Tell me which email address to invite, or run `pnpm --filter @luxebaddie/backend owner:invite:dev you@example.com`. You get an email with a temporary password; at the first sign-in you choose your own password and set up an authenticator app (1Password, Google Authenticator, Authy or similar)
- [x] Orders screens (2026-11-15):
  - Four queues that an order moves through: To order, Ordered from vendor, On its way, Delivered. Oldest first, so nothing gets forgotten at the bottom
  - An order's page: what was bought, the address laid out as it goes on a parcel, the totals, the customer, and a link that opens the payment in Stripe
  - One search box: type an order number to open that order, or an email address to see everything that customer has bought
- [x] Fulfillment actions (2026-11-15):
  - Mark an order as ordered from the vendor (with the vendor's own order number, if they give one), then as shipped with the carrier and tracking number, then as delivered. Each step is dated
  - The order of steps is enforced by the store itself, not just the screen: an order cannot skip a step or go backwards, and a refused step says why in plain words
  - Every step asks for a second click, because none can be undone. A mistyped carrier or tracking number can be corrected while the order is on its way
  - Tracking numbers for USPS, UPS, FedEx and DHL link to the carrier's tracking page
  - If two people work the same order, the second is told it changed instead of overwriting the first
  - Checked on `dev` in a real browser: one order taken through all three steps
  - Not yet: the customer is not emailed when an order ships. That arrives with the shipping emails in Phase 3
- [x] Catalog screens (2026-11-15):
  - The whole catalog on one screen, by category, in the order the shop shows it, with drafts marked
  - Add and edit a product: name, tagline, description, highlights, what shoppers choose between (up to three options, such as Length and Density) and a price for every choice, with an optional "was" price
  - A new product starts as a draft that only you can see. Switch it to "For sale" to publish it, and back to draft to take it off the shop without losing it
  - Set its position in its category, and tick a box to feature it on the home page
  - Stop selling a single choice (a length the vendor ran out of) without removing it
  - Remove a product, with a second click to confirm. Orders already placed keep their own copy of what was bought
  - Mistakes are explained in plain words before anything is saved, for example "Row 2: enter a price above zero"
  - A new product can never overwrite an existing one: its shop address has to be free
  - The shop updates on its own a few minutes after a product that is for sale is saved
- [ ] Photo upload: add product photos from the back office. They are stored on AWS and served through the CDN, which is where the Phase 3 photography lands
- [ ] Activity log: every back-office change is recorded with who made it and when

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
- [ ] **(you)** Business email addresses on the domain (for example `support@` and `orders@`), once the domain is registered. Order emails are sent from them, and vendors and customers reply to them
- [ ] **(you)** Decide store policies: shipping times, returns and exchanges (worn or opened hair and lashes are normally final sale for hygiene), order cancellation
- [ ] **(you)** Decide where you ship. The checkout accepts US addresses only today
- [ ] **(you)** Sales tax: confirm with a tax advisor where you must collect. Then in Stripe Tax set the head office address, choose the product tax code for hair goods from Stripe's list, and add a registration for each place you are registered. Only after that do we switch tax collection on; without a registration Stripe collects nothing and gives no warning
- [ ] **(you)** Resale certificate (seller's permit): ask the tax advisor in the same conversation. Vendors commonly ask for one before selling to you at wholesale without charging you sales tax
- [ ] **(you)** Business bank account and bookkeeping for the LLC, if not already set up
- [ ] **(you)** Ask an insurance agent about product liability cover. Lashes and adhesives touch skin and eyes, and a dropshipper is still the seller of record
- [ ] Decide whether production runs in this AWS account or a dedicated one for the business. A dedicated account is the cleaner choice: it is the only way to guarantee the `dev` pipeline cannot touch production

## Phase 3 - Launch readiness

Turning the working engine into a store that is ready for real customers.

- [ ] Replace the placeholder catalog with the real vendor line: names, descriptions, options, prices with healthy margin after vendor cost, shipping, Stripe fees and ad spend
- [ ] Product photography and video (samples from Phase 2), hosted on a CDN
- [ ] Final shipping rates and free-shipping threshold (currently placeholders: $7.95 flat, free over $150)
- [ ] Policy pages: shipping, returns, privacy, terms. Contact page and FAQ
- [ ] Email sending set up on the domain so messages reach the inbox instead of spam (a verified sending domain with SPF, DKIM and DMARC). Comes before any customer email
- [ ] Order confirmation and shipping notification emails
- [ ] Production environment: restricted live Stripe keys, real domain, data backups on, alarm emails to you
  - Its own back-office sign-in, with a separate owner account from `dev`
  - A spending alert, so an unexpected AWS bill is flagged the day it starts rather than at month end
  - A dedicated encryption key for the live Stripe keys, and an alarm if anything unexpected reads them
- [ ] A plain-language guide for each alarm: what it means, what to check, and how to replay an order or a site rebuild that failed
- [ ] See the problems shoppers hit in their browser (page errors, slow pages on phones). Today's monitoring sees the servers and whether pages are delivered, not what happens once a page is open on someone's phone
- [ ] Point the real domain at the storefront: certificate, DNS, and tell browsers to always use HTTPS for the domain (HSTS preload)
- [ ] Decide how to shield the storefront from floods and bots before ads start: a web application firewall on the CDN (a monthly fee plus a per-request charge) or one of CloudFront's flat-rate plans (firewall included, no surprise bills from traffic spikes, but fewer logging options on the free tier)
- [ ] Production deploy pipeline: the same build that passed on `dev` is promoted to production only after you approve it in GitHub, followed by an automatic check that the live store still works. Production gets its own deploy role, with narrower rights than the `dev` one, so the `dev` pipeline can never touch it
- [ ] Refunds and disputes: keep orders in step when a payment is refunded or charged back in Stripe
- [ ] Tell the shopper when a pay-later payment is declined after checkout (the `CheckoutPaymentFailed` event already exists)
- [ ] Fraud screening: review Stripe's fraud rules (Radar) before launch. Hair is a common target for stolen cards, and a dropshipped order cannot be pulled back once the vendor ships it
- [ ] Walk through Stripe's go-live checklist
- [ ] Accessibility pass: every page usable by keyboard and screen reader, with readable contrast. It is the right thing to do, and online stores are a frequent target of accessibility complaints
- [ ] SEO basics: titles, descriptions, sitemap, social share images
- [ ] Analytics and ad pixels (Meta, TikTok) with server-side conversion tracking
- [ ] Cookie and tracking consent to go with the pixels: a notice, a way to opt out, and a privacy policy that matches what the site actually collects
- [ ] Launch checklist: a real purchase and refund with a live card, on a phone

## Phase 4 - Automation

The goal is a store that runs with you supervising rather than operating. Each automation subscribes to business events (like `CheckoutCompleted`), so they can be added one at a time without touching what already works.

- [ ] Order forwarding: a paid order is sent to the vendor automatically
- [ ] Tracking: vendor tracking numbers flow back and the customer is notified
- [ ] "Where is my order" page: a shopper enters their order number and email and sees the status and tracking, without writing to support
- [ ] Stock sync: when the vendor runs out of a length or color it shows as unavailable on the site automatically. Today it has to be switched off by hand
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
- [ ] Email and SMS list: signup offer, welcome series, launches. Sign-up records consent and every message carries an unsubscribe, which the law requires for both
- [ ] Discount codes for launch and for creators. The checkout already accepts them; the codes are created in Stripe, and each creator gets their own so sales can be traced back

## Phase 6 - Grow

- [ ] Customer reviews with photos
- [ ] Bundle deals (bundles + closure, wig + care kit)
- [ ] Stock bestsellers for faster delivery and better margin
- [ ] Customer accounts and order history
- [ ] Staff accounts for the back office, with limited permissions (for example, someone who can work orders but not change prices)
- [ ] Search and filters (length, texture, lace type) once the catalog is big enough to need them
- [ ] Shipping outside the US
- [ ] Expand the line: hair care, beauty products, accessories

## Open questions

- Which vendor(s)? Everything in Phase 3 depends on it.
- Is the brand name clear to use (trademark search)?
- Production AWS account: this one or a dedicated account?
- Will anyone besides you need back-office access at launch? If so, staff accounts move up from Phase 6.
- US only at launch, or other countries too?
