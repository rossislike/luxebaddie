# Activity diagrams

The flow of events and decisions inside each bounded context. Rounded nodes are the start and finish, rectangles are actions, and diamonds are decisions. Where a path leaves the context (an event published, a reply sent) the node says so.

These follow the application service and domain functions of each context line by line, so a changed rule should show up here as a changed branch. See the [index](README.md) for the bounded contexts.

## Basket: pricing a bag

The rule every other basket flow depends on. Pure domain logic with no outside calls.

Source: `backend/src/basket/domain/pricing.ts`, `backend/src/basket/domain/shipping.ts`.

```mermaid
flowchart TD
    start([Items and the products they refer to])
    merge[Merge items with the same productId and sku into one line, adding quantities]
    next{Another item to price?}
    exists{Does the product exist?}
    active{Is the product active?}
    variant{Does it have an active variant with this SKU?}
    price[Price the line: unit price from the variant, times quantity]
    remove[Set the item aside as removed]
    subtotal[Subtotal = sum of the line totals]
    any{Any priced lines?}
    threshold{"Subtotal at or above the free-shipping threshold ($150)?"}
    free[Shipping = 0]
    flat["Shipping = flat rate ($7.95)"]
    none[Shipping = 0, the bag is empty]
    done([PricedBasket: lines, subtotal, shipping, removed])

    start --> merge --> next
    next -- Yes --> exists
    exists -- No --> remove
    exists -- Yes --> active
    active -- No --> remove
    active -- Yes --> variant
    variant -- No --> remove
    variant -- Yes --> price
    price --> next
    remove --> next
    next -- No --> subtotal --> any
    any -- No --> none --> done
    any -- Yes --> threshold
    threshold -- Yes --> free --> done
    threshold -- No --> flat --> done
```

The shipping numbers are placeholders until vendor shipping costs are known (see the roadmap).

## Basket: starting checkout

Source: `backend/src/basket/application/basket-service.ts` (`startCheckout`).

```mermaid
flowchart TD
    start([Shopper asks to check out])
    valid{Is the basket id a UUID?}
    bad([Reject: 400 invalid])
    load[Load the basket's items. An expired or unknown basket is empty]
    price[Price the bag from the current catalog]
    removed{Was anything set aside as no longer for sale?}
    save[Save the bag without the removed items]
    changed([Stop: 409 conflict, with the refreshed bag for the shopper to review])
    empty{Is the bag empty?}
    isEmpty([Stop: 409 conflict, the bag is empty])
    session[Create a hosted checkout for exactly this priced bag]
    url{Did the payment provider return a page URL?}
    fail([Fail: 500, nothing was charged])
    done([Reply with the URL. The shopper leaves for the payment page])

    start --> valid
    valid -- No --> bad
    valid -- Yes --> load --> price --> removed
    removed -- Yes --> save --> changed
    removed -- No --> empty
    empty -- Yes --> isEmpty
    empty -- No --> session --> url
    url -- No --> fail
    url -- Yes --> done
```

The order of the two checks matters. A bag whose last item was just delisted is reported as "no longer available", not as "empty", so the shopper learns why.

## Payment: handling a notification

Source: `backend/src/payment/adapters/http.ts`, `backend/src/payment/application/payment-service.ts`, `backend/src/payment/adapters/stripe-payment-provider.ts`.

```mermaid
flowchart TD
    start([Stripe calls the webhook])
    signed{Is there a signature header?}
    verify{Does the signature match the payload?}
    reject([Reject: 400. Nothing is published])
    kind{What kind of notification?}
    stageA{Is the session from this stage?}
    stageB{Is the session from this stage?}
    read[Read the session back from Stripe]
    paid{Is the session still unpaid?}
    lines[Read the line items and translate them, using each line's productId and sku tags]
    tagged{Does every line carry its tags?}
    notOurs([Fail: 500. Stripe will retry, and an alarm fires])
    completed[Publish CheckoutCompleted]
    failed[Publish CheckoutPaymentFailed]
    published{Was the event published?}
    retry([Fail: 500. Stripe delivers the notification again later])
    ack([Reply 200 received])
    ignore([Reply 200 received. Nothing to do])

    start --> signed
    signed -- No --> reject
    signed -- Yes --> verify
    verify -- No --> reject
    verify -- Yes --> kind
    kind -- "Checkout completed, or pay-later payment succeeded" --> stageA
    kind -- "Pay-later payment failed" --> stageB
    kind -- "Anything else" --> ignore
    stageA -- No --> ignore
    stageA -- Yes --> read --> paid
    paid -- "Yes, a pay-later method is still pending" --> ignore
    paid -- No --> lines --> tagged
    tagged -- No --> notOurs
    tagged -- Yes --> completed --> published
    stageB -- No --> ignore
    stageB -- Yes --> failed --> published
    published -- No --> retry
    published -- Yes --> ack
```

A pay-later purchase passes through here twice: once at checkout, where the session is still unpaid and nothing is published, and again when the payment succeeds or fails.

## Ordering: recording a paid checkout

Source: `backend/src/ordering/adapters/order-queue.ts`, `backend/src/ordering/application/order-service.ts`, `backend/src/ordering/domain/order.ts`.

```mermaid
flowchart TD
    start([A CheckoutCompleted event arrives from the order queue])
    shape{Does the event match the agreed schema?}
    derive[Derive the order number from the checkout session id]
    build[Build the order: the purchase details, status unfulfilled, created now]
    save[Save the order, only if no order has this number]
    outcome{Was it saved?}
    created([Done: order created])
    load[Load the order that already has this number]
    same{Is it for the same checkout session?}
    duplicate([Done: this event was already processed. Nothing changed])
    collision[Raise an order number collision]
    back[The message goes back to the queue and is tried again]
    tries{Has it failed 5 times?}
    dlq([Dead-letter queue. An alarm fires for a person to look])

    start --> shape
    shape -- No --> back
    shape -- Yes --> derive --> build --> save --> outcome
    outcome -- Yes --> created
    outcome -- "No, one already exists" --> load --> same
    same -- Yes --> duplicate
    same -- No --> collision --> back
    back --> tries
    tries -- No --> start
    tries -- Yes --> dlq
```

Two different payments mapping to one order number is astronomically unlikely, but the flow makes sure it would be loud. A paid order is never silently dropped.

## Catalog: saving a product

Source: `backend/src/product/adapters/http.ts`, `packages/contracts/src/catalog.ts` (`productSchema`), `backend/src/product/adapters/catalog-change-stream.ts`.

```mermaid
flowchart TD
    start([Admin saves a product])
    signed{Is the request signed with AWS credentials?}
    denied([Reject: 403])
    fields{Do the fields pass validation: slug id, known category, 1 to 100 variants, prices in whole cents?}
    skus{Is every SKU unique within the product?}
    options{Does every variant have exactly the option keys in optionNames?}
    match{Does the id in the body match the id in the URL?}
    invalid([Reject: 400, naming what is wrong])
    save[Replace the whole product, variants included]
    reply([Reply 200 with the product])
    stream[The table records the committed write]
    relay[The change relay reads the product id from the saved item]
    publish[Publish CatalogChanged: saved]
    finish([The storefront context takes it from here])

    start --> signed
    signed -- No --> denied
    signed -- Yes --> fields
    fields -- No --> invalid
    fields -- Yes --> skus
    skus -- No --> invalid
    skus -- Yes --> options
    options -- No --> invalid
    options -- Yes --> match
    match -- No --> invalid
    match -- Yes --> save
    save --> reply
    save -.-> stream --> relay --> publish --> finish
```

The dotted line is the hand-off from the request to the background: the admin gets their reply as soon as the product is saved, and the event follows from the table's own record of the write. Removing a product follows the same path and publishes `CatalogChanged: removed`.

## Storefront: bringing the site up to date

Source: `backend/src/storefront/adapters/rebuild-queue.ts`, `backend/src/storefront/application/storefront-service.ts`.

```mermaid
flowchart TD
    trigger1([CatalogChanged event])
    trigger2([A deployment finished])
    queue[The message waits in the rebuild queue]
    collect[Collect whatever else arrives within 30 seconds into one batch]
    ask[Ask the builder to start a build]
    running{Is a build already running?}
    started[One build starts for the whole batch]
    defer[Hand the whole batch back to the queue]
    wait[Wait for the queue's retry delay]
    build[Read the catalog, generate every page, upload the site, clear the CDN cache]
    ok{Did the build succeed?}
    live([The site is current])
    alarm([An alarm fires. The previous version of the site stays up])

    trigger1 --> queue
    trigger2 --> queue
    queue --> collect --> ask --> running
    running -- No --> started --> build --> ok
    running -- Yes --> defer --> wait --> ask
    ok -- Yes --> live
    ok -- No --> alarm
```

Why a busy builder defers instead of dropping the request: the build that is already running may have read the catalog before this change was made, so it does not count. Trying again later guarantees a build that starts after the last change.
