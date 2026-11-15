# Data model

LuxeBaddie stores everything in one DynamoDB table (single-table design). This document is the source of truth for that table. **Change it first, then the code.** Key formats live in code in exactly one place, `src/table/`, and the table itself is defined in `lib/database.ts`.

## Why one table

DynamoDB has no joins and only reads efficiently one way: go to one partition key, then read a run of neighbouring sort keys. So items are arranged ahead of time so that each thing the application needs to read already sits together, in the right order. Every read below is either a single-item lookup or one such run. Nothing scans the table or filters after reading.

## Entities

```
Product 1 --- N Variant          variants are stored inside the product
Basket  1 --- N BasketLine       lines are stored inside the basket
Order   1 --- N OrderLine        lines are stored inside the order
Customer 1 --- N Order           a customer is identified by email; there is no Customer item yet
```

Three item types are stored: `Product`, `Basket`, `Order`. The "many" sides above are kept inside their parent because each is small and capped (100 variants, 30 basket lines, and an order's lines come from a basket) and is never read without its parent.

## Access patterns

Collected from the API routes, the event consumers, and the near-term roadmap.

| # | Entity | Access pattern | Used by |
| --- | --- | --- | --- |
| 1 | Product | Get a product by id | product page, admin |
| 2 | Product | List products for sale, by category then position | storefront build |
| 3 | Product | List products for sale in one category, by position | storefront build |
| 4 | Product | List every product, drafts included | admin |
| 5 | Product | Create or replace a product; delete a product | admin |
| 5a | Product | Add a product only if its id is free | back office |
| 6 | Product | Get several products by id | pricing a basket |
| 7 | Basket | Get a basket by id | bag |
| 8 | Basket | Replace a basket's lines; delete a basket | bag, after payment |
| 9 | Basket | Abandoned baskets disappear after 30 days | housekeeping |
| 10 | Order | Record a paid checkout exactly once | payment event |
| 11 | Order | Get an order by order number | confirmation page, admin |
| 12 | Order | List orders in a fulfillment state, oldest first, paged | fulfillment queue |
| 13 | Order | List one customer's orders by email, newest first, paged | customer support |
| 14 | Order | Move an order one fulfillment step on, or correct its tracking, only if nobody else changed it first | back office |

## Entity chart

| Entity | PK | SK | GSI1PK | GSI1SK | GSI2PK | GSI2SK |
| --- | --- | --- | --- | --- | --- | --- |
| Product | `PRODUCT#<id>` | `PRODUCT#<id>` | `CATALOG` | `PRODUCT#<status>#<category>#<position>#<id>` | | |
| Basket | `BASKET#<basketId>` | `BASKET#<basketId>` | | | | |
| Order | `ORDER#<orderId>` | `ORDER#<orderId>` | `CUSTOMER#<email>` | `ORDER#<paidAt>#<orderId>` | `FULFILLMENT#<status>` | `ORDER#<createdAt>#<orderId>` |

Notes on the values:

- `<position>` is zero-padded to six digits so that 10 sorts after 9.
- `<email>` is trimmed and lower-cased in the key. The order keeps the email as typed.
- `<paidAt>` and `<createdAt>` are ISO-8601 UTC timestamps, which sort correctly as text.
- An order with no email has no `GSI1` keys, so it appears in no customer's list.
- An order's fulfillment progress (`fulfillmentStatus`, `vendorOrderReference`, `orderedFromVendorAt`, `shipment`, `shippedAt`, `deliveredAt`) is the only part of it that is ever rewritten. Orders stored before these attributes existed lack them and read as not yet fulfilled; no backfill was needed.
- Baskets also carry `TTL` (epoch seconds). Every item carries `Type`.

What sits together as a result:

```
GSI1, partition CATALOG                         the whole catalog, in display order
  PRODUCT#active#lashes#000090#soft-glam-lashes
  PRODUCT#active#weaves#000050#body-wave-bundle
  PRODUCT#active#wigs#000010#body-wave-lace-front-wig
  PRODUCT#active#wigs#000020#silky-straight-hd-lace-wig
  PRODUCT#draft#wigs#000030#...

GSI1, partition CUSTOMER#bea@example.com        one customer's orders, by date
  ORDER#2026-11-01T10:00:00.000Z#LB-...
  ORDER#2026-11-14T12:00:00.000Z#LB-...

GSI2, partition FULFILLMENT#unfulfilled         the work queue, oldest first
  ORDER#2026-11-14T12:00:05.000Z#LB-...
```

## How each access pattern is served

| # | Access pattern | Index | Operation | Key condition and notes |
| --- | --- | --- | --- | --- |
| 1 | Get product | Main table | GetItem | `PK = SK = PRODUCT#<id>` |
| 2 | Products for sale | GSI1 | Query | `GSI1PK = CATALOG AND begins_with(GSI1SK, "PRODUCT#active#")` |
| 3 | Products for sale in a category | GSI1 | Query | `GSI1PK = CATALOG AND begins_with(GSI1SK, "PRODUCT#active#<category>#")` |
| 4 | Every product | GSI1 | Query | `GSI1PK = CATALOG AND begins_with(GSI1SK, "PRODUCT#")` |
| 5 | Save / delete product | Main table | PutItem / DeleteItem | Unconditional put: an admin save is a deliberate overwrite |
| 5a | Add product | Main table | PutItem | Condition `attribute_not_exists(PK)`. A product's id is its address in the shop, so adding one must never replace another |
| 6 | Several products by id | Main table | BatchGetItem | Up to 100 keys per call; unprocessed keys are re-requested |
| 7 | Get basket | Main table | GetItem | `PK = SK = BASKET#<basketId>`. Expired baskets are treated as empty even if still stored |
| 8 | Replace / delete basket | Main table | PutItem / DeleteItem | Unconditional put: the shopper's latest bag overwrites. Sets `TTL` |
| 9 | Basket expiry | | TTL | DynamoDB deletes lazily, hence the read-time check in 7 |
| 10 | Record paid checkout | Main table | PutItem | Condition `attribute_not_exists(PK)`. The order number is derived from the checkout session, so a redelivered payment event hits the condition instead of creating a second order |
| 11 | Get order | Main table | GetItem | `PK = SK = ORDER#<orderId>` |
| 12 | Fulfillment queue | GSI2 | Query | `GSI2PK = FULFILLMENT#<status>`, ascending, `Limit` + cursor |
| 13 | Customer's orders | GSI1 | Query | `GSI1PK = CUSTOMER#<email>`, descending, `Limit` + cursor |
| 14 | Change fulfillment | Main table | UpdateItem | `SET` the fulfillment attributes and `GSI2PK`/`GSI2SK` together (`fulfillmentAttributes`), so the order changes queue in the same write. Condition `attribute_exists(PK) AND fulfillmentStatus = <the status the change started from>`: of two people working one order, the second is refused instead of overwriting the first |

## Decisions and their reasons

- **Base keys are the entity's id and nothing else.** They never change, the caller always has them, and for orders it is what makes "record once" enforceable (uniqueness can only be enforced on the base table key).
- **Anything that changes or is used for sorting lives in an index key**, never in the base key: product status, category and position; order fulfillment state.
- **The catalog is one partition in GSI1** (`CATALOG`). That is deliberate: the catalog is small (hundreds of products at most), it is read when the storefront is built rather than on every page view, and index partitions have no size limit. The composite sort key lets one index serve patterns 2, 3 and 4 by prefix, without filtering.
- **Catalog lists are not paged to callers.** The storefront needs the whole catalog to build; the repository reads every page internally.
- **Order lists are paged**, because both grow without limit.
- **GSI1 is shared** by two unrelated patterns (the catalog and customers' orders). Each index has its own key attributes; no attribute is used as a key in two indexes.
- **Every fulfillment state is indexed, including `delivered`.** A leaner design would drop delivered orders from GSI2. It was not worth a special case: the index has no size limit and reads are paged.
- **Index reads are eventually consistent.** A product or order can take a moment to show up in a list after it is written. Everything that must read its own write immediately (get by id, the confirmation page) uses the base table.
- **Fulfillment is a conditional update, not a read-then-write.** The service reads the order to decide whether a step is allowed, but what makes it safe is the condition on the write: the stored status must still be the one the decision was based on.
- **Each service can only touch its own items.** IAM allows an action only when the partition key starts with that service's prefix: product `PRODUCT#` (and `CATALOG` in GSI1), basket `BASKET#` plus read-only `PRODUCT#`, ordering `ORDER#` (and `CUSTOMER#` in GSI1, `FULFILLMENT#` in GSI2). The payment service has no table access.
- **Throughput ceilings.** A single partition handles roughly 1,000 writes per second. Every new order writes to `FULFILLMENT#unfulfilled` in GSI2, so that is the theoretical ceiling for order intake. It is far beyond any plausible volume for this store.

## Change stream

The table's stream is on (`NEW_AND_OLD_IMAGES`): DynamoDB keeps an ordered record of every committed write for 24 hours, with the item as it was before and after. Events that announce a write are published from that record instead of by the code that made the write, so an event and the table can never disagree.

| Feed | Items | Relay | Event |
| --- | --- | --- | --- |
| Catalog | `PK` begins with `PRODUCT#` | `src/product/change-relay.ts` | `CatalogChanged` (`productId`, `saved` or `removed`) |

- A feed (`lib/change-feed.ts`) filters the stream by key prefix, so a relay is only ever handed its own service's items. The filter is a delivery rule, not a permission: IAM cannot restrict stream reads by key, which is why each relay is its own Lambda with no other access to the table.
- A relay reads the product id from the item itself (the old image for a delete), never from the key.
- Delivery is at-least-once and in order per item. Subscribers must tolerate the same change arriving twice.
- A change the relay fails on ten times goes to the feed's dead-letter queue, and an alarm fires.

## Rules for the code

- Key strings are built only in `src/table/*-item.ts`. Repositories call those functions; nothing else knows a key format.
- Indexing attributes (`PK`, `SK`, `GSI1PK`, `GSI1SK`, `GSI2PK`, `GSI2SK`, `Type`, `TTL`) are separate from business data. Business values are never parsed out of a key.
- One repository function per access pattern above.
- Creates are conditional unless the overwrite is intended and says so in a comment.
- To look at real data by access pattern rather than by raw keys: `pnpm --filter @luxebaddie/backend db dev <pattern> [argument]` (run it with no pattern to see the list).

## Changing the model

- **Additive** (no existing items need rewriting): a new attribute, a new entity with its own keys, a new entity added to an existing collection.
- **Needs a backfill** (existing items must be rewritten by a scan-and-update script, filtered on `Type`): a new index over existing items, or a changed key format. Add the key function in `src/table/`, deploy the index (one new index per deployment on an existing table), backfill, then switch the read path.

Likely next changes:

| Change | Kind | Sketch |
| --- | --- | --- |
| Orders by date, for the daily owner's report | Backfill | New index, partition per month (`ORDERS#<yyyy-mm>`), sorted by `paidAt` |
| `OrderPlaced` events for emails and vendor forwarding | Additive | A second change feed (`lib/change-feed.ts`) on the `ORDER#` prefix, with its own relay Lambda in the ordering service |
| Customer accounts | Additive | `Customer` item at `CUSTOMER#<email>` |
