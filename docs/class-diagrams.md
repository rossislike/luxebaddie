# Class diagrams

Entities, value objects and aggregates, one diagram per bounded context. See the [index](README.md) for what each stereotype means in this codebase.

How to read them:

- A filled diamond (`*--`) is composition: the part lives and dies with its aggregate and is stored inside it.
- A dashed arrow (`..>`) is a dependency: "uses" or "creates".
- A dashed arrow with a hollow head (`..|>`) is an adapter implementing a port.
- One aggregate never holds a reference to another aggregate's object. It holds the other's id (`productId`, `basketId`, `checkoutSessionId`).

## Catalog

Source: `packages/contracts/src/catalog.ts`, `backend/src/product/application`.

```mermaid
classDiagram
    direction LR

    class Product {
        <<Aggregate Root>>
        +ProductId id
        +string name
        +CategorySlug category
        +string tagline
        +string description
        +string[] highlights
        +string[] optionNames
        +Url[] images
        +ProductStatus status
        +boolean featured
        +int position
        +variantTitle(variant) string
        +startingPriceCents() Cents
    }

    class Variant {
        <<Entity>>
        +Sku sku
        +Map options
        +Cents priceCents
        +Cents compareAtCents
        +boolean active
    }

    class ProductStatus {
        <<enumeration>>
        draft
        active
    }

    class CategorySlug {
        <<enumeration>>
        wigs
        weaves
        lashes
    }

    class Cents {
        <<Value Object>>
        +int amount
    }

    class CatalogService {
        <<Application Service>>
        +listProductsForSale(category) Product[]
        +getProductForSale(id) Product
        +listAllProducts() Product[]
        +getProduct(id) Product
        +addProduct(product) void
        +saveProduct(product) void
        +removeProduct(id) void
    }

    class ProductRepository {
        <<Repository>>
        +findById(id) Product
        +findForSale(category) Product[]
        +findAll() Product[]
        +save(product) void
        +saveNew(product) created or already exists
        +remove(id) void
    }

    class CatalogEventPublisher {
        <<Port>>
        +publishChanges(changes) void
    }

    class CatalogChanged {
        <<Domain Event>>
        +ProductId productId
        +string change
    }

    Product "1" *-- "1..100" Variant : variants
    Product --> ProductStatus
    Product --> CategorySlug
    Variant --> Cents
    CatalogService ..> ProductRepository : uses
    ProductRepository ..> Product : loads and saves whole
    CatalogEventPublisher ..> CatalogChanged : publishes

    note for Product "Invariants (productSchema):<br/>- at least 1 variant, at most 100<br/>- SKUs are unique within the product<br/>- every variant has exactly the option keys in optionNames<br/>- id is a URL-safe slug and never changes"
    note for Variant "Identified by its SKU, but only inside its product.<br/>Other contexts refer to it as productId + sku."
    note for CatalogChanged "change is saved or removed.<br/>Published from the table's change stream,<br/>not by CatalogService."
```

Notes:

- **Aggregate boundary.** A product is always saved and read whole, variants included. There is no "update one variant" operation: an admin save replaces the product.
- **For sale** means the product is `active` and the variant is `active`. Shoppers only ever see products for sale; admins see drafts too.
- **`CatalogService` does not publish events.** It only saves. `CatalogChanged` is produced by the change relay (`backend/src/product/change-relay.ts`) from the record of committed writes, so the event and the data cannot disagree.

## Basket

Source: `packages/contracts/src/basket.ts`, `backend/src/basket/domain`, `backend/src/basket/application`.

```mermaid
classDiagram
    direction LR

    class Basket {
        <<Aggregate Root>>
        +BasketId id
        +DateTime updatedAt
        +DateTime expiresAt
    }

    class BasketItem {
        <<Value Object>>
        +ProductId productId
        +Sku sku
        +int quantity
    }

    class PricedBasket {
        <<Value Object>>
        +BasketId id
        +Cents subtotalCents
        +Cents shippingCents
        +Cents freeShippingThresholdCents
    }

    class PricedLine {
        <<Value Object>>
        +ProductId productId
        +Sku sku
        +int quantity
        +string productName
        +string variantTitle
        +Cents unitPriceCents
        +Cents lineTotalCents
        +Url image
    }

    class Pricing {
        <<Domain Service>>
        +priceBasket(id, items, products) PricedBasket
        +itemsOf(pricedBasket) BasketItem[]
    }

    class ShippingPolicy {
        <<Domain Service>>
        +Cents STANDARD_SHIPPING_CENTS = 795
        +Cents FREE_SHIPPING_THRESHOLD_CENTS = 15000
        +shippingCentsFor(subtotalCents) Cents
    }

    class BasketService {
        <<Application Service>>
        +viewBasket(basketId) PricedBasket
        +replaceItems(basketId, items) PricedBasket
        +discardBasket(basketId) void
        +startCheckout(basketId, returnTo) Url
    }

    class BasketRepository {
        <<Repository>>
        +findItems(basketId) BasketItem[]
        +saveItems(basketId, items) void
        +remove(basketId) void
    }

    class Catalog {
        <<Port>>
        +findProducts(productIds) Map
    }

    class CheckoutGateway {
        <<Port>>
        +startCheckout(pricedBasket, returnTo) Url
    }

    class StripeCheckoutGateway {
        <<Adapter>>
    }

    Basket "1" *-- "0..30" BasketItem : items
    PricedBasket "1" *-- "0..*" PricedLine : lines
    PricedBasket "1" *-- "0..*" BasketItem : removed
    Pricing ..> PricedBasket : creates
    Pricing ..> ShippingPolicy : uses
    BasketService ..> Pricing : uses
    BasketService ..> BasketRepository : uses
    BasketService ..> Catalog : uses
    BasketService ..> CheckoutGateway : uses
    BasketRepository ..> Basket : loads and saves whole
    StripeCheckoutGateway ..|> CheckoutGateway

    note for Basket "Anonymous: the id is a random UUID the browser<br/>generates and keeps.<br/>Expires 30 days after its last save.<br/>A basket that was never saved is simply empty."
    note for BasketItem "quantity is 1 to 10.<br/>Holds no price: the browser never sends one."
    note for PricedBasket "Never stored. Computed on every read<br/>from the basket and the current catalog."
    note for Catalog "Read-only view of the Catalog context's<br/>Product aggregate, by id."
```

Notes:

- **What is stored and what is computed.** The stored aggregate is small: an id and up to 30 `BasketItem`s. `PricedBasket` is a value computed fresh each time, so a price change in the catalog shows up in the bag on the next read, and a tampered request cannot change what the shopper pays.
- **Pricing rules** (`domain/pricing.ts`): repeated `productId` + `sku` pairs are merged into one line; an item whose product or variant is no longer for sale is moved to `removed` rather than priced; shipping is the flat rate below the free-shipping threshold and zero at or above it; an empty bag has no shipping.
- **The basket refers to products by id only.** `Catalog` is the basket's own narrow port onto another context's data, which is why it is named for what the basket needs and not after the product service.

## Payment

Source: `backend/src/payment/application`, `backend/src/payment/adapters/stripe-payment-provider.ts`.

```mermaid
classDiagram
    direction LR

    class PaymentService {
        <<Application Service>>
        +handleNotification(notification) void
    }

    class PaymentNotification {
        <<Value Object>>
        +string payload
        +string signature
    }

    class PaymentEvent {
        <<Value Object>>
        +string type
    }

    class PaymentProvider {
        <<Port>>
        +readNotification(notification) PaymentEvent
    }

    class EventPublisher {
        <<Port>>
        +publish(event) void
    }

    class StripePaymentProvider {
        <<Anti-Corruption Layer>>
        -verify(payload, signature) StripeEvent
        -readPaidCheckout(sessionId, paidAt) PaymentEvent
        -isFromThisStage(session) boolean
    }

    class CheckoutCompleted {
        <<Domain Event>>
    }

    class CheckoutPaymentFailed {
        <<Domain Event>>
    }

    PaymentService ..> PaymentProvider : uses
    PaymentService ..> EventPublisher : uses
    PaymentProvider ..> PaymentNotification : reads
    PaymentProvider ..> PaymentEvent : returns, or nothing
    PaymentEvent --> CheckoutCompleted : checkout_completed
    PaymentEvent --> CheckoutPaymentFailed : checkout_payment_failed
    EventPublisher ..> PaymentEvent : publishes
    StripePaymentProvider ..|> PaymentProvider

    note for PaymentService "Owns no data, so there is no aggregate here.<br/>If publishing fails, Stripe is told the notification<br/>failed and delivers it again."
    note for StripePaymentProvider "The only code that knows how Stripe models<br/>a payment. Everything past it speaks<br/>CheckoutCompleted and CheckoutPaymentFailed."
```

Notes:

- **No aggregate, by design.** This context is a translator. Its whole job is to turn Stripe's vocabulary (`checkout.session.completed`, `payment_status`, line item metadata) into the business's vocabulary, and announce it.
- **`PaymentEvent` is a tagged union** of the two domain events. `readNotification` returns nothing for notifications the business does not act on: other event types, sessions from another stage, and sessions whose pay-later payment is still pending.

## Ordering

Source: `packages/contracts/src/order.ts`, `backend/src/ordering/domain/order.ts`, `backend/src/ordering/application`.

```mermaid
classDiagram
    direction LR

    class Order {
        <<Aggregate Root>>
        +OrderId id
        +string checkoutSessionId
        +string paymentIntentId
        +FulfillmentStatus fulfillmentStatus
        +string vendorOrderReference
        +DateTime orderedFromVendorAt
        +DateTime shippedAt
        +DateTime deliveredAt
        +string email
        +string customerName
        +string phone
        +string shippingName
        +Cents subtotalCents
        +Cents discountCents
        +Cents shippingCents
        +Cents taxCents
        +Cents totalCents
        +string currency
        +DateTime paidAt
        +DateTime createdAt
    }

    class OrderItem {
        <<Value Object>>
        +ProductId productId
        +Sku sku
        +string description
        +Cents unitPriceCents
        +int quantity
    }

    class Address {
        <<Value Object>>
        +string line1
        +string line2
        +string city
        +string state
        +string postalCode
        +string country
    }

    class Shipment {
        <<Value Object>>
        +string carrier
        +string trackingNumber
    }

    class FulfillmentStatus {
        <<enumeration>>
        unfulfilled
        processing
        shipped
        delivered
    }

    class FulfillmentStep {
        <<Value Object>>
        ordered-from-vendor (vendorOrderReference)
        shipped (shipment)
        delivered
    }

    class FulfillmentPolicy {
        <<Domain Service>>
        +whyStepIsRefused(order, step) string
        +takeStep(order, step, at) Order
        +whyShipmentCorrectionIsRefused(order) string
        +correctShipment(order, shipment) Order
    }

    class OrderConfirmation {
        <<Value Object>>
        +OrderId id
        +string email
        +string shippingName
        +Address shippingAddress
        +OrderItem[] items
        +Cents totals
        +DateTime paidAt
    }

    class OrderFactory {
        <<Factory>>
        +orderIdForSession(checkoutSessionId) OrderId
        +orderFromCheckout(checkout, createdAt) Order
        +confirmationOf(order) OrderConfirmation
    }

    class OrderService {
        <<Application Service>>
        +recordPaidCheckout(checkout) SaveOutcome
        +getConfirmation(checkoutSessionId) OrderConfirmation
        +getOrder(id) Order
        +listByFulfillmentStatus(status, page) Page
        +listForCustomer(email, page) Page
        +takeFulfillmentStep(id, step) Order
        +correctShipment(id, shipment) Order
    }

    class OrderRepository {
        <<Repository>>
        +saveIfNew(order) SaveOutcome
        +findById(id) Order
        +saveFulfillment(order, from) FulfillmentSaveOutcome
        +findByFulfillmentStatus(status, page) Page
        +findByCustomerEmail(email, page) Page
    }

    class CheckoutCompleted {
        <<Domain Event>>
    }

    Order "1" *-- "1..*" OrderItem : items
    Order "1" *-- "0..1" Address : shippingAddress
    Order "1" *-- "0..1" Shipment : shipment
    Order --> FulfillmentStatus
    FulfillmentPolicy ..> FulfillmentStep : applies
    FulfillmentPolicy ..> Order : moves forward
    OrderService ..> FulfillmentPolicy : uses
    OrderFactory ..> CheckoutCompleted : reads
    OrderFactory ..> Order : creates
    OrderFactory ..> OrderConfirmation : creates
    OrderService ..> OrderFactory : uses
    OrderService ..> OrderRepository : uses
    OrderRepository ..> Order : saves once, loads whole,<br/>rewrites fulfillment only

    note for Order "Invariants:<br/>- id is derived from checkoutSessionId, so one<br/>  payment can only ever be one order<br/>- created only from a CheckoutCompleted event<br/>- starts as unfulfilled<br/>- has at least one item<br/>- what was bought is never rewritten<br/>- fulfillment only moves forward, one step<br/>  at a time: unfulfilled, processing, shipped, delivered<br/>- has a shipment from the moment it ships"
    note for OrderItem "A snapshot: the description and price are what<br/>the customer saw and paid, copied at purchase.<br/>Later catalog changes do not touch it."
    note for OrderConfirmation "What the buyer may see.<br/>No payment or internal identifiers."
```

Notes:

- **The order number is the idempotency key.** `orderIdForSession` hashes the checkout session id into a readable number like `LB-7K3M9Q2XAB`. The same session always gives the same number, and `saveIfNew` refuses to overwrite, so a payment event delivered twice still produces one order.
- **An order copies what it needs and keeps it.** `OrderItem` carries `productId` and `sku` as references back to the catalog, but its description and price are frozen at purchase.
- **`Customer` is implicit.** Today a customer is the `email` on their orders, which is what `findByCustomerEmail` uses. There is no `Customer` aggregate yet.
- **Fulfillment only moves forward.** `domain/fulfillment.ts` holds the rule: `unfulfilled` to `processing` (ordered from the vendor) to `shipped` to `delivered`, one step at a time, never skipping and never back. A refused step comes with the reason in plain words, which the back office shows as is. The one change allowed without moving is correcting the carrier or tracking number while an order is on its way.
- **Two people cannot both move one order.** `saveFulfillment` only stores a change if the order is still in the status the change started from, so the second person is told the order changed instead of overwriting the first.

## Storefront

Source: `backend/src/storefront/application`.

```mermaid
classDiagram
    direction LR

    class StorefrontService {
        <<Application Service>>
        +requestRebuild() RebuildOutcome
    }

    class StorefrontBuilder {
        <<Port>>
        +startBuild() BuildRequest
    }

    class BuildRequest {
        <<Value Object>>
        +string outcome
        +string buildId
    }

    class RebuildOutcome {
        <<enumeration>>
        started
        deferred
    }

    class CodeBuildStorefrontBuilder {
        <<Adapter>>
    }

    StorefrontService ..> StorefrontBuilder : uses
    StorefrontService ..> RebuildOutcome : returns
    StorefrontBuilder ..> BuildRequest : returns
    CodeBuildStorefrontBuilder ..|> StorefrontBuilder

    note for StorefrontService "Rule: only one build at a time.<br/>deferred means a build is already running,<br/>and the caller must ask again later."
    note for BuildRequest "outcome is started (with a buildId) or busy."
```

Notes:

- **No aggregate here either.** The published site is derived entirely from the catalog, so this context holds one rule and no data: an older build must never finish after a newer one.

## Domain events

Source: `packages/contracts/src/events.ts`. These are the published language between contexts.

```mermaid
classDiagram
    direction LR

    class CheckoutCompleted {
        <<Domain Event>>
        +string checkoutSessionId
        +string paymentIntentId
        +BasketId basketId
        +string email
        +string customerName
        +string phone
        +string shippingName
        +Address shippingAddress
        +OrderItem[] items
        +Cents subtotalCents
        +Cents discountCents
        +Cents shippingCents
        +Cents taxCents
        +Cents totalCents
        +string currency
        +DateTime paidAt
    }

    class CheckoutPaymentFailed {
        <<Domain Event>>
        +string checkoutSessionId
        +BasketId basketId
        +string email
        +string customerName
    }

    class CatalogChanged {
        <<Domain Event>>
        +ProductId productId
        +string change
    }

    class Payment {
        <<Bounded Context>>
    }
    class Catalog {
        <<Bounded Context>>
    }
    class Ordering {
        <<Bounded Context>>
    }
    class Basket {
        <<Bounded Context>>
    }
    class Storefront {
        <<Bounded Context>>
    }

    Payment ..> CheckoutCompleted : publishes
    Payment ..> CheckoutPaymentFailed : publishes
    Catalog ..> CatalogChanged : publishes
    CheckoutCompleted ..> Ordering : records the order
    CheckoutCompleted ..> Basket : empties the paid bag
    CatalogChanged ..> Storefront : rebuilds the site
```

| Event | Source | Means | Subscribers today |
| --- | --- | --- | --- |
| `CheckoutCompleted` | `com.luxebaddie.payment` | A shopper paid, confirmed by Stripe | Ordering, Basket |
| `CheckoutPaymentFailed` | `com.luxebaddie.payment` | A pay-later payment was declined after checkout. Nothing was charged and no order exists | None yet (telling the shopper is on the roadmap) |
| `CatalogChanged` | `com.luxebaddie.product` | A product was saved or removed | Storefront |

`CheckoutCompleted` carries everything an order needs, so the ordering context never has to call back to payment or Stripe. Delivery is at-least-once, so every subscriber is idempotent.
