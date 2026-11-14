---
name: dynamodb-data-modeling
description: 'Design, review, implement, and migrate Amazon DynamoDB data models with access-pattern-first, single-table design: primary key and GSI design, item collections, one-to-many and many-to-many strategies, filtering, sorting, sparse indexes, uniqueness, counters, pagination, TTL, Streams, transactions, and expressions. Use when the user mentions "DynamoDB", "single-table design", "partition key", "sort key", "PK/SK", "GSI", "access patterns", "item collection", "hot partition", "sparse index", "adjacency list", "ConditionExpression", "TransactWriteItems", or "NoSQL data model". Also trigger when choosing keys for a new table, translating a relational schema or ERD to DynamoDB, replacing a Scan or filter expression with a Query, adding an access pattern or entity to an existing table, writing a backfill script, defining a table in CloudFormation, Serverless, CDK, or Terraform, or writing DynamoDB data-access code, even if the user does not say "data modeling".'
metadata:
  source: 'The DynamoDB Book (Alex DeBrie, 2020) and its companion Node.js code examples (session store, e-commerce, Big Time Deals, GitHub, GitHub migration)'
  version: "1.0.0"
---

# DynamoDB Data Modeling

A working method for designing DynamoDB tables that stay fast at any scale, plus a catalog of named strategies for relationships, filtering, sorting, and migrations, and five fully worked examples with code. DynamoDB rewards up-front design and punishes improvisation, so the method matters as much as the strategies.

## Core Principle

**You model for your access patterns, not for your data.** A relational database lets you normalize first and figure out queries later, because joins and a query planner do the work at read time. DynamoDB has no joins and deliberately refuses to do anything that would get slower as the table grows. Every efficient read is "go to one partition key, then read a contiguous range of sort keys". So the design job is to arrange items ahead of time so that each access pattern's items already sit next to each other, in the right order, in one item collection. If a requirement cannot be expressed that way on the base table or an index, the model is not finished.

Three consequences follow, and most mistakes come from ignoring one of them:

1. **Access patterns come before keys.** Never pick a partition key before the full list of reads and writes is written down.
2. **Item collections are the unit of design.** Items sharing a partition key are the "pre-joined" result set. Ask of every access pattern: which item collection serves it, and where in the sort order do its items sit?
3. **The primary key does the filtering and sorting.** Filter expressions run after items are read and after the 1MB page limit, so they save bandwidth, not cost or latency. Treat them as a finishing touch on an already narrow result.

## How to Use This Skill

Work out which situation applies, then follow that path. Read the linked reference before producing the design or code; the references hold the decision rules, key layouts, and gotchas that this file only summarizes.

| Situation | Path |
|---|---|
| New table or new application | Follow the Modeling Workflow below, start to finish |
| "Is DynamoDB right for this?" or conceptual questions | [fundamentals.md](references/fundamentals.md) |
| Reviewing an existing model or slow/expensive queries | Design Review Checklist below, then the strategy reference for each failing item |
| Adding a feature to an existing table | [migrations-and-additional-strategies.md](references/migrations-and-additional-strategies.md): decide additive vs backfill first |
| Writing or debugging a specific request or expression | [api-and-expressions.md](references/api-and-expressions.md) |
| Writing application code for a finished model | [implementation-patterns.md](references/implementation-patterns.md) |
| The application resembles one of the worked examples | Read that example first; adapt rather than reinvent |

If the user has not given the access patterns, ask for them or draft a list and have it confirmed before designing keys. A model built on guessed access patterns is the most common and most expensive failure in DynamoDB, because changing keys later means rewriting existing items.

## Modeling Workflow

Details, templates, and the single-table trade-offs are in [modeling-process.md](references/modeling-process.md).

1. **Understand the application and draw the ERD.** Entities, attributes, relationships with cardinality. Do this even for small models.
2. **List every access pattern.** Walk the API endpoints or the UI screens. Capture sort order, "latest N", filters, uniqueness rules, expiry, and which writes are conditional. Record them in an access pattern chart.
3. **Model the primary key.** Start an entity chart (Entity, PK, SK). Use a composite key with generic attribute names `PK` and `SK` unless the model is truly key-value. Give each entity a key that guarantees uniqueness first, then use the remaining freedom to build item collections for the "fetch many" patterns. Prefix values with the entity type (`CUSTOMER#<id>`, `ORDER#<id>`), and only use values the client will know at read time.
4. **Apply a strategy to each relationship and each filter or sort requirement.** Use the Strategy Selector below.
5. **Add secondary indexes for what the primary key cannot serve.** Overload them (`GSI1PK`, `GSI1SK`) so one index serves several patterns; do not create one index per query. Consider Streams for derived data and fan-out.
6. **Close the loop.** Fill in the access pattern chart: index, key condition, operation, and parameters for every row. Any row that resolves to a Scan, a broad filter expression, or a chain of serial requests needs an explicit justification.

Deliver both charts with every design. They are the model's source of truth and the first thing a reviewer or a future maintainer needs.

```markdown
| Entity   | PK                  | SK                | GSI1PK              | GSI1SK            |
|----------|---------------------|-------------------|---------------------|-------------------|
| Customer | CUSTOMER#<Username> | CUSTOMER#<Username> |                   |                   |
| Order    | CUSTOMER#<Username> | #ORDER#<OrderId>  | ORDER#<OrderId>     | ORDER#<OrderId>   |
| OrderItem| ORDER#<OrderId>#ITEM#<ItemId> | ORDER#<OrderId>#ITEM#<ItemId> | ORDER#<OrderId> | ITEM#<ItemId> |

| Access pattern            | Index      | Operation | Key condition / notes                                         |
|---------------------------|------------|-----------|---------------------------------------------------------------|
| Get customer + latest orders | Main table | Query  | PK = CUSTOMER#<Username>, ScanIndexForward=false, Limit=11    |
| Get order + order items   | GSI1       | Query     | GSI1PK = ORDER#<OrderId>                                      |
```

## Strategy Selector

| Need | Strategy | Reference |
|---|---|---|
| Children are few, bounded, and only read through the parent | Complex attribute (list or map on the parent) | [relationship-strategies.md](references/relationship-strategies.md) |
| Child reads need a few parent facts that rarely change | Duplicate the data onto the children | [relationship-strategies.md](references/relationship-strategies.md) |
| Fetch a parent with its children in one request (the common case) | Shared partition key + Query on the base table | [relationship-strategies.md](references/relationship-strategies.md) |
| Same, but the base key is already used for something else | Item collection in a secondary index + Query | [relationship-strategies.md](references/relationship-strategies.md) |
| Several levels of hierarchy, queried at any level | Composite sort key (`COUNTRY#STATE#CITY#ZIP`) | [relationship-strategies.md](references/relationship-strategies.md) |
| Many-to-many where one side needs only a little stable data | Shallow duplication | [relationship-strategies.md](references/relationship-strategies.md) |
| Many-to-many read from both sides | Adjacency list (relationship item + inverted index) | [relationship-strategies.md](references/relationship-strategies.md) |
| Heavily interconnected data, many relationship types | Materialized graph | [relationship-strategies.md](references/relationship-strategies.md) |
| Many-to-many where the related data changes often | Normalize, then Query + BatchGetItem | [relationship-strategies.md](references/relationship-strategies.md) |
| Filter on two attributes together (status + date) | Composite sort key (`<Status>#<Timestamp>`) | [filtering-and-sorting.md](references/filtering-and-sorting.md) |
| Find the few items in a state ("unread", "open", "admins") or all items of one type | Sparse index | [filtering-and-sorting.md](references/filtering-and-sorting.md) |
| Chronological order with unique IDs | Sortable ID such as a KSUID in the sort key | [filtering-and-sorting.md](references/filtering-and-sorting.md) |
| Sort by an attribute that changes | Keep the base key immutable, sort in a GSI | [filtering-and-sorting.md](references/filtering-and-sorting.md) |
| Parent plus newest children; or two child types around one parent | Parent placement in the collection + `ScanIndexForward` | [filtering-and-sorting.md](references/filtering-and-sorting.md) |
| Numbers inside string sort keys | Zero-padding; zero-padded difference for reverse order | [filtering-and-sorting.md](references/filtering-and-sorting.md) |
| Unique value on a non-key attribute (email, username) | Extra tracking item written in the same transaction with `attribute_not_exists` | [migrations-and-additional-strategies.md](references/migrations-and-additional-strategies.md) |
| Sequential, human-friendly IDs | Counter on the parent, incremented with `ReturnValues`, then write | [migrations-and-additional-strategies.md](references/migrations-and-additional-strategies.md) |
| Count of related items (likes, stars) without duplicates | Transaction: conditional put of the relation item + counter increment | [migrations-and-additional-strategies.md](references/migrations-and-additional-strategies.md) |
| Paginated lists | Cursor built from the last-seen sort key | [migrations-and-additional-strategies.md](references/migrations-and-additional-strategies.md) |
| One-off global records (front page, feature lists) | Singleton item with a fixed key | [migrations-and-additional-strategies.md](references/migrations-and-additional-strategies.md) |
| Global "latest items" feed that would overload one partition | Shard the partition key by truncated timestamp, walk buckets backward | [example-big-time-deals.md](references/example-big-time-deals.md) |
| Expiring data | TTL attribute, plus a filter on read because deletion lags | [fundamentals.md](references/fundamentals.md) |
| React to writes, fan out, maintain aggregates | DynamoDB Streams + Lambda | [example-big-time-deals.md](references/example-big-time-deals.md) |

Most real models combine several of these. Pick from the problem; do not start from a favorite pattern.

## Worked Examples

Each example reference contains the ERD, the full access pattern list, the final entity chart, the reasoning for every key, the pattern-to-operation map, code from the companion project, and the places where the book and the code disagree.

| Example | Shows | Reference |
|---|---|---|
| Session store | Simple key, TTL with read-time filter, index for bulk revocation | [example-session-store-and-ecommerce.md](references/example-session-store-and-ecommerce.md) |
| E-commerce | Uniqueness on two attributes, complex attribute for addresses, customer + orders collection, order + items in a GSI, transactional order creation | [example-session-store-and-ecommerce.md](references/example-session-store-and-ecommerce.md) |
| Big Time Deals | Time-sharded feeds, singleton items, likes and watches with reference counts, sparse index for unread messages, Streams fan-out | [example-big-time-deals.md](references/example-big-time-deals.md) |
| GitHub backend | Eight entities in one table, shared sequential numbering, adjacency lists, forks, stars, users and orgs in one namespace | [example-github.md](references/example-github.md) |
| GitHub migration | Evolving a live model: additive changes vs ETL backfills, new indexes, open vs closed ordering | [example-github.md](references/example-github.md) |

## Implementation Rules

The full treatment with code is in [implementation-patterns.md](references/implementation-patterns.md). The rules that prevent the most rework:

- **Keep indexing attributes separate from application attributes.** `PK`, `SK`, `GSI1PK` are for DynamoDB; `Username`, `OrderId` are for the application. Duplicating a value into both is fine. This is what makes later migrations possible without touching business data.
- **Translate at the boundary.** One entity class or module per item type owns key construction, `toItem()`, and `fromItem()`. The rest of the application never sees `PK` or typed attribute values.
- **One data-access function per access pattern.** The function names should read like the access pattern chart. Avoid generic ORMs and relational-style repositories; they hide item collections, which are the whole point of the design.
- **Put a `Type` attribute on every item.** It makes mixed query results, stream handlers, migrations, and analytics exports tractable.
- **Do not reuse one attribute as a key in two indexes.** It couples access patterns that will need to change independently.
- **Make writes conditional by default.** `attribute_not_exists(PK)` on creates, state checks on updates, and `TransactWriteItems` whenever two items must change together (uniqueness, counters, relationships).
- **Paginate every Query and Scan** with `LastEvaluatedKey`; results are capped at 1MB per page regardless of `Limit` or filters.

The book and its companion code date from 2020 (AWS SDK for JavaScript v2, a 10-item transaction limit). The modeling advice is unchanged, but check current service limits and SDK syntax before quoting specifics. The references label facts that are newer than the book, and list defects in the companion code that should not be copied.

## Common Mistakes

| Mistake | Why it hurts | Do instead |
|---|---|---|
| One table per entity with joins in application code | Serial requests, latency grows with relationships | Pre-join in item collections |
| Choosing keys before listing access patterns | Keys cannot be changed without rewriting items | Finish the access pattern chart first |
| Relying on filter expressions or Scan to find items | You pay for and wait on everything read, not what is returned | Design a key or sparse index for the pattern |
| A timestamp in the primary key only to make it unique | The client cannot rebuild the key later for reads and updates | Use an identifier the client holds; put time in the sort key via a sortable ID |
| Unbounded list or map inside an item | Hits the 400KB item limit and makes every read heavier | Separate child items in the collection |
| One GSI per query | Extra write cost and index sprawl | Overload generic `GSI1PK`/`GSI1SK` across entity types |
| Everything under a single partition key value | Hot partition, throughput ceiling per partition | Spread the key; shard by time or bucket for global feeds |
| Assuming TTL deletes on time | Expired items can linger for a long while | Also filter on the TTL attribute at read time |
| Read-then-write to enforce a rule | Race conditions | Condition expression or transaction |
| Numeric values in string sort keys without padding | `10` sorts before `9` | Zero-pad to a fixed width |
| Strongly consistent expectations on a GSI | GSIs are eventually consistent only | Serve read-after-write paths from the base table |

## Design Review Checklist

- [ ] An ERD, an entity chart, and an access pattern chart exist and agree with each other.
- [ ] Every access pattern maps to a GetItem, a Query with a key condition, or a justified exception. No unplanned Scans.
- [ ] Every entity's primary key guarantees uniqueness and is built only from values the caller has at read time.
- [ ] Each relationship names the strategy it uses, and unbounded relationships are not stored inside a single item.
- [ ] Sort order requirements are met by sort key design, including parent placement and `ScanIndexForward` direction.
- [ ] Uniqueness on non-key attributes is enforced with tracking items in a transaction.
- [ ] Counters and relationship writes are transactional and idempotent against duplicates.
- [ ] No partition key value can receive a disproportionate share of traffic or grow without bound where an LSI exists.
- [ ] Secondary indexes are overloaded where sensible, their eventual consistency is acceptable for the patterns they serve, and no attribute is shared between two indexes.
- [ ] Items carry a `Type` attribute, and indexing attributes are separate from application attributes.
- [ ] Item sizes are bounded well under 400KB; large or rarely read attributes are split out.
- [ ] TTL-based expiry is paired with a read-time filter.
- [ ] Every list endpoint paginates with a cursor.
- [ ] Planned changes are classified as additive or backfill, and backfills have a scan-and-update script.

## Reference Index

| File | Read when |
|---|---|
| [fundamentals.md](references/fundamentals.md) | Deciding whether DynamoDB fits; keys, indexes, item collections, Streams, TTL, partitions, consistency, limits, overloading |
| [api-and-expressions.md](references/api-and-expressions.md) | Writing any request: item actions, Query, Scan, all five expression types, optional request properties |
| [modeling-process.md](references/modeling-process.md) | Starting a design; chart templates; single-table design and when not to use it |
| [relationship-strategies.md](references/relationship-strategies.md) | Modeling any one-to-many or many-to-many relationship |
| [filtering-and-sorting.md](references/filtering-and-sorting.md) | Any filter, ordering, "latest N", or sparse index requirement |
| [migrations-and-additional-strategies.md](references/migrations-and-additional-strategies.md) | Changing an existing model; uniqueness, sequential IDs, pagination, singletons, reference counts |
| [implementation-patterns.md](references/implementation-patterns.md) | Writing entity classes, data-access functions, table definitions, stream handlers, migration scripts |
| [example-session-store-and-ecommerce.md](references/example-session-store-and-ecommerce.md) | Sessions, tokens, customers, orders, order items |
| [example-big-time-deals.md](references/example-big-time-deals.md) | Feeds, likes, watches, notifications, fan-out |
| [example-github.md](references/example-github.md) | Large relational models and their evolution over time |
