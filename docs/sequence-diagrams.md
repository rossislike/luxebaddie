# Sequence diagrams

How objects and components talk to each other, in order, for the flows that matter most. Solid arrows are calls, dashed arrows are replies, and open arrowheads are asynchronous messages (events and queues), where the sender does not wait.

Participants are named as in the code: application services (`BasketService`), ports (`CheckoutGateway`, `OrderRepository`) and domain functions (`priceBasket`). See the [index](README.md) for the bounded contexts.

## 1. Saving the bag

The shopper adds an item. The browser sends ids and quantities only, and gets back a priced bag.

Source: `backend/src/basket/adapters/http.ts`, `backend/src/basket/application/basket-service.ts`, `backend/src/basket/domain/pricing.ts`.

```mermaid
sequenceDiagram
    autonumber
    actor Shopper
    participant Web as Storefront (browser)
    participant Http as Basket HTTP adapter
    participant Service as BasketService
    participant Catalog as Catalog port
    participant Pricing as priceBasket (domain)
    participant Repo as BasketRepository

    Shopper->>Web: Add to bag
    Web->>Http: PUT /basket/{id} with items (productId, sku, quantity)
    Http->>Http: Validate the id is a UUID and the body matches the schema
    Http->>Service: replaceItems(basketId, items)
    Service->>Catalog: findProducts(productIds)
    Catalog-->>Service: Products by id
    Service->>Pricing: priceBasket(basketId, items, products)
    Note right of Pricing: Merge duplicate lines, price each from its variant,<br/>set aside anything no longer for sale, add shipping
    Pricing-->>Service: PricedBasket (lines, subtotal, shipping, removed)
    Service->>Repo: saveItems(basketId, items still for sale)
    Repo-->>Service: Saved, expiry reset to 30 days
    Service-->>Http: PricedBasket
    Http-->>Web: 200 PricedBasket
    Web-->>Shopper: Bag with current prices
```

Viewing the bag (`GET /basket/{id}`) is the same without the save (steps 9 and 10): the stored items are read, then priced from the current catalog.

## 2. Starting checkout

The basket context hands the shopper to Stripe. Nothing is charged here and no order exists yet.

Source: `backend/src/basket/application/basket-service.ts`, `backend/src/basket/adapters/stripe-checkout-gateway.ts`.

```mermaid
sequenceDiagram
    autonumber
    actor Shopper
    participant Web as Storefront (browser)
    participant Service as BasketService
    participant Repo as BasketRepository
    participant Catalog as Catalog port
    participant Gateway as CheckoutGateway (Stripe adapter)
    participant Stripe

    Shopper->>Web: Checkout
    Web->>Service: POST /basket/{id}/checkout
    Service->>Repo: findItems(basketId)
    Repo-->>Service: BasketItems
    Service->>Catalog: findProducts(productIds)
    Catalog-->>Service: Products by id
    Service->>Service: priceBasket(...)

    alt Some items are no longer for sale
        Service->>Repo: saveItems(basketId, items still for sale)
        Service-->>Web: 409 Conflict with the refreshed bag
        Web-->>Shopper: Show what changed, ask to review
    else The bag is empty
        Service-->>Web: 409 Conflict
    else The bag is exactly what the shopper last saw
        Service->>Gateway: startCheckout(pricedBasket, returnTo)
        Gateway->>Stripe: Create Checkout Session (lines tagged with productId and sku, basketId and stage in metadata)
        Stripe-->>Gateway: Session with hosted page URL
        Gateway-->>Service: URL
        Service-->>Web: 200 with the URL
        Web->>Stripe: Redirect the shopper to the hosted payment page
    end
```

The rule in the first branch is the important one: a shopper is never charged for a bag that differs from what they last saw.

## 3. From payment to order

Stripe confirms the payment, the payment context announces it, and two other contexts react on their own.

Source: `backend/src/payment`, `backend/src/ordering/adapters/order-queue.ts`, `backend/src/basket/adapters/paid-basket-queue.ts`, `backend/lib/eventbus.ts`.

```mermaid
sequenceDiagram
    autonumber
    actor Shopper
    participant Stripe
    participant Payment as PaymentService
    participant Provider as PaymentProvider (anti-corruption layer)
    participant Bus as Event bus
    participant Ordering as OrderService
    participant Orders as OrderRepository
    participant Basket as BasketService

    Shopper->>Stripe: Pay on the hosted page
    Stripe->>Payment: POST /payment/webhook (payload, signature)
    Payment->>Provider: readNotification(notification)
    Provider->>Provider: Verify the signature
    Provider->>Stripe: Read the session back, and its line items
    Stripe-->>Provider: Session (paid) and line items
    Provider-->>Payment: PaymentEvent checkout_completed
    Payment-)Bus: Publish CheckoutCompleted
    Payment-->>Stripe: 200 received

    par Ordering reacts
        Bus-)Ordering: CheckoutCompleted (order queue)
        Ordering->>Ordering: orderFromCheckout(checkout, now)
        Note right of Ordering: Order number derived from the checkout session id
        Ordering->>Orders: saveIfNew(order)
        Orders-->>Ordering: created
    and Basket reacts
        Bus-)Basket: CheckoutCompleted (paid-basket queue)
        Basket->>Basket: discardBasket(basketId)
    end
```

Things this diagram is designed to show:

- **The order is created from the webhook, never from the browser.** A shopper can pay and close the tab and still get their order.
- **Payment does not know ordering or basket exist.** It publishes one event. Adding a subscriber (confirmation emails, forwarding to a vendor) changes nothing upstream.
- **Stripe is answered only after the event is published.** If publishing fails, the webhook returns an error and Stripe delivers the notification again.

### What happens on a redelivery

Delivery is at-least-once at every hop, so the same `CheckoutCompleted` can arrive twice. The order's identity makes that harmless.

```mermaid
sequenceDiagram
    autonumber
    participant Bus as Event bus
    participant Ordering as OrderService
    participant Orders as OrderRepository

    Bus-)Ordering: CheckoutCompleted (same session, again)
    Ordering->>Ordering: orderFromCheckout(checkout, now)
    Note right of Ordering: Same session id gives the same order number
    Ordering->>Orders: saveIfNew(order)
    Orders-->>Ordering: already_exists
    Ordering->>Orders: findById(orderId)
    Orders-->>Ordering: The existing order
    alt Same checkout session
        Ordering-->>Bus: Done. Nothing changed
    else A different session produced the same number
        Ordering-->>Bus: Fail loudly, so the message is retried and then lands in the dead-letter queue
    end
```

## 4. The confirmation page

The shopper returns from Stripe before the order may exist. The page waits for it.

Source: `web/src/components/order-confirmation.tsx`, `backend/src/ordering/application/order-service.ts`.

```mermaid
sequenceDiagram
    autonumber
    actor Shopper
    participant Stripe
    participant Web as Confirmation page (browser)
    participant Ordering as OrderService
    participant Orders as OrderRepository

    Stripe->>Web: Redirect to /checkout/success?session_id=...
    Web->>Web: Reset the local bag

    loop Up to 20 tries, 1.5 seconds apart
        Web->>Ordering: GET /order/session/{sessionId}
        Ordering->>Ordering: orderIdForSession(sessionId)
        Ordering->>Orders: findById(orderId)
        alt The order has been recorded
            Orders-->>Ordering: Order
            Ordering->>Ordering: confirmationOf(order)
            Ordering-->>Web: 200 OrderConfirmation
            Web-->>Shopper: Order number, items and totals
        else Not yet
            Orders-->>Ordering: Nothing
            Ordering-->>Web: 404 Not found
        end
    end

    opt Still not found after the last try
        Web-->>Shopper: Thank you. Payment received, order still being finalized
    end
```

The session id is a long random value only the buyer's browser holds, and the page receives an `OrderConfirmation`, which leaves out payment and internal identifiers.

## 5. A catalog change reaches the storefront

An admin saves a product. About two minutes later the published site shows it, without anyone deploying anything.

Source: `backend/src/product`, `backend/src/product/change-relay.ts`, `backend/src/storefront`, `backend/lib/change-feed.ts`.

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant Catalog as CatalogService
    participant Products as ProductRepository
    participant Stream as Table change stream
    participant Relay as Change relay
    participant Bus as Event bus
    participant Storefront as StorefrontService
    participant Builder as StorefrontBuilder

    Admin->>Catalog: PUT /admin/product/{id} (signed request)
    Catalog->>Products: save(product, activity entry)
    Products-->>Catalog: Saved, with the entry, in one transaction
    Catalog-->>Admin: 200 product
    Note over Catalog,Products: The catalog's work is finished here. It publishes nothing itself.

    Products-)Stream: The committed write is recorded
    Stream-)Relay: Product change (before and after)
    Relay-)Bus: Publish CatalogChanged (productId, saved)
    Bus-)Storefront: CatalogChanged (rebuild queue, collected for 30 seconds)
    Storefront->>Builder: startBuild()

    alt No build is running
        Builder-->>Storefront: started (buildId)
        Note right of Builder: The build reads the catalog from the API, generates every page,<br/>uploads the site and clears the CDN cache
    else A build is already running
        Builder-->>Storefront: busy
        Storefront-->>Bus: deferred. The messages go back to the queue and are tried again
    end
```

Why the event comes from the change stream and not from `CatalogService`: a service that both saves and publishes can do one and fail the other. The stream only contains writes that were committed, so the event can never announce a change that did not happen, and no committed change goes unannounced.

## 6. The owner signs in and takes a fulfillment step

The owner opens an order in the back office and marks it as shipped. Three things are checked before anything is stored: that the caller is a signed-in owner, that the step is the order's next one, and that nobody else moved the order in the meantime.

Source: `backoffice/src/auth`, `backend/lib/owner-sign-in.ts`, `backend/lib/apigateway.ts`, `backend/src/ordering`, `backend/src/shared/adapters/dynamodb-activity.ts`.

```mermaid
sequenceDiagram
    autonumber
    actor Owner
    participant Office as Back office (browser)
    participant Cognito as Cognito sign-in pages
    participant Gateway as API Gateway
    participant Orders as OrderService
    participant Policy as FulfillmentPolicy
    participant Repo as OrderRepository

    Owner->>Office: Opens the back office
    Office->>Office: No session: show "Taking you to sign-in" and nothing else
    Office->>Cognito: Redirect to sign in (authorization code flow with PKCE)
    Owner->>Cognito: Password, then authenticator code
    Cognito-->>Office: Redirect back with a one-time code
    Office->>Cognito: Exchange the code for tokens
    Cognito-->>Office: Sign-in token (15 minutes) and a renewal token (12 hours)

    Owner->>Office: Mark order as shipped (carrier, tracking number), clicked twice
    Office->>Gateway: POST /backoffice/order/{id}/fulfillment-step, with the token
    Gateway->>Cognito: Is this token one of ours, and still valid?
    alt No valid token
        Gateway-->>Office: 401. The back office sends the owner to sign in again
    else Valid
        Gateway->>Orders: takeFulfillmentStep(id, step, actor = the owner's email from the token)
        Orders->>Repo: findById(id)
        Orders->>Policy: whyStepIsRefused(order, step)
        alt Not the order's next step
            Orders-->>Office: 409, with the reason in plain words
        else The next step
            Orders->>Policy: takeStep(order, step, now)
            Orders->>Repo: saveFulfillment(order, from, activity entry)
            Note right of Repo: One transaction: update the order only if it is still<br/>in the status it was read in, and add the activity entry
            alt Someone else changed the order first
                Repo-->>Orders: changed meanwhile. Nothing was written
                Orders-->>Office: 409. Reload and try again
            else Stored
                Repo-->>Orders: saved
                Orders-->>Office: 200, the order as it now is
            end
        end
    end
```

The same routes exist under `/admin` for AWS-signed requests. There API Gateway checks the request's signature instead of a token, and the actor recorded is the AWS identity that signed it.

