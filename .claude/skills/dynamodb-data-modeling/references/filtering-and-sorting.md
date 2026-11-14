# Filtering and Sorting Strategies

How to get "only these items, in this order" out of DynamoDB by designing primary keys (base table and secondary indexes) instead of relying on query-time predicates. Read this when an access pattern has a filter condition, a time range, a status, a "most recent N", or any ordering requirement.

## Contents

- [Core rule](#core-rule)
- [Strategy selection](#strategy-selection)
- Filtering
  - [Partition key](#1-filter-with-the-partition-key)
  - [Sort key: simple range conditions](#2-filter-with-the-sort-key-simple-range-conditions)
  - [Sort key: assembling different collections of items](#3-filter-with-the-sort-key-assembling-different-collections-of-items)
  - [Composite sort key](#4-composite-sort-key)
  - [Sparse indexes](#5-sparse-indexes)
  - [Filter expressions](#6-filter-expressions)
  - [Client-side filtering](#7-client-side-filtering)
- Sorting
  - [Sorting basics](#sorting-basics)
  - [Sorting on changing attributes](#sorting-on-changing-attributes)
  - [Ascending vs descending and parent placement](#ascending-vs-descending-and-parent-placement)
  - [Two relational access patterns in one item collection](#two-relational-access-patterns-in-one-item-collection)
  - [Zero-padding numbers](#zero-padding-numbers)
  - [Faking ascending order (zero-padded difference)](#faking-ascending-order-zero-padded-difference)
- [Review checklist](#review-checklist)

---

## Core rule

Filtering and sorting in DynamoDB happen almost entirely through the primary key, where "primary key" means the key of the base table or of any secondary index. Items must be arranged in advance so that the items an access pattern wants are contiguous in one item collection and already in the wanted order.

- The partition key gives an O(1) hop from the whole table down to one item collection (one storage node, at most 10GB). Every API except Scan requires it.
- Within an item collection, items sit in a B-tree ordered by sort key, so range conditions and ordering are O(log n) plus the items read.
- Ordering therefore requires a **composite primary key**, and all ordering is done by the **sort key of one item collection**. There is no ORDER BY on arbitrary attributes.

If a condition is not expressible as "partition key equals X, sort key in range Y", it is either a new index, a filter expression on an already-narrow result, or client-side work.

---

## Strategy selection

### Filtering

| Need | Strategy | Key design | Cost / caveat |
|---|---|---|---|
| Split data into groups fetched together | Partition key | `PK = <ENTITY>#<ParentId>` on table or GSI | Starting point for everything else |
| Subset by an inherently ordered value (time range, score range) | Sort key range | `SK = <Timestamp>` with `BETWEEN`, `<`, `>=` | Sort key must be sortable |
| Parent plus one of several child types in one collection | Sort key arrangement | Children placed before/after the parent; `SK <= parent` or `SK >= parent` | Ordering is an artifact of your layout, not of the data |
| Always filter on two attributes together, one enum-like | Composite sort key | `SK = <Status>#<Timestamp>` | Low-cardinality value must come first |
| Rare condition inside an entity type ("only admins", "only open") | Sparse index (conditional attribute) | Index key attribute present only on matching items | Can live in an overloaded index |
| "All items of type X" across the table | Sparse index (single entity type) | Dedicated index keyed on an attribute only that type has; Scan it | Cannot share with an overloaded index |
| Drop a few extra items from an already narrow result | Filter expression | n/a | You pay for everything read; breaks `Limit` |
| Many ad hoc filters/sorts over a small set (< 1MB) | Client-side filtering | Fetch the whole narrowed set | Only after the partition key has narrowed it |

### Sorting

| Need | Strategy | Key design |
|---|---|---|
| Unique ID that also sorts chronologically | KSUID | `SK = ORDER#<KSUID>` |
| Sort by a value that changes (updated-at, score) | Immutable base key + GSI on the changing attribute | Base `SK = TICKET#<Id>`, GSI `SK = <UpdatedAt>` |
| Parent + most recent children in one Query | Place parent after children, read backward | Child `SK = #READING#<ts>`, `ScanIndexForward=false` |
| Parent + child type A, and parent + child type B, same collection | Parent in the middle, read in opposite directions | `#TEAM#...` < `ORG#...` < `USER#...` |
| Numeric order inside a string sort key | Zero-pad | `ISSUE#0000042` |
| Two numeric child types, both newest-first, same collection | Zero-padded difference for one of them | `READING#<99999 - n, padded>` read forward |

---

## 1. Filter with the partition key

The first and cheapest filter. Decide what gets retrieved together and give those items the same partition key, on the base table or on an index.

| Access pattern | Where | Key |
|---|---|---|
| Movies for an actor | Base table | `PK = Actor`, `SK = Movie` |
| Actors in a movie | GSI (inverted) | `PK = Movie`, `SK = Actor` |

A second "group by" dimension means a second index with that dimension as its partition key. Do not try to reach a group via Scan plus filter.

## 2. Filter with the sort key: simple range conditions

Use when the item collection is a clean group under one parent and the sort key is inherently meaningful (date, score). Works on tables and indexes with a composite key; there is nothing to filter on with a simple primary key.

| Entity | PK | SK |
|---|---|---|
| Order | `CustomerId` | `OrderTime` (ISO-8601) |

```js
// Orders for one customer placed in a time window
{
  TableName: 'CustomerOrders',
  KeyConditionExpression: '#c = :c AND #ot BETWEEN :start AND :end',
  ExpressionAttributeNames: { '#c': 'CustomerId', '#ot': 'OrderTime' },
  ExpressionAttributeValues: {
    ':c':     { S: '36ab55a589e4' },
    ':start': { S: '2020-01-11T00:00:00.000000' },
    ':end':   { S: '2020-02-01T00:00:00.000000' }
  }
}
```

Sort key conditions available in a key condition: `=`, `<`, `<=`, `>`, `>=`, `BETWEEN`, `begins_with`. Only one sort key condition per Query.

## 3. Filter with the sort key: assembling different collections of items

Use when one item collection holds a parent and more than one type of related item, and each access pattern wants the parent plus only one of those types. Here the sort key values have no business meaning for ordering; the range condition exploits where you chose to place each type.

Layout (GitHub example: Repo with Issues and Stars):

| Entity | PK | SK | Position |
|---|---|---|---|
| Issue | `REPO#<Owner>#<Repo>` | `ISSUE#<IssueNumber>` | Before the Repo (`I` < `R`) |
| Repo | `REPO#<Owner>#<Repo>` | `REPO#<Owner>#<Repo>` | Middle |
| Star | `REPO#<Owner>#<Repo>` | `STAR#<Username>` | After the Repo (`S` > `R`) |

| Access pattern | Sort key condition | ScanIndexForward |
|---|---|---|
| Repo + Issues | `SK <= REPO#<Owner>#<Repo>` | `false` (start at Repo, walk backward through Issues) |
| Repo + Stars | `SK >= REPO#<Owner>#<Repo>` | `true` (start at Repo, walk forward through Stars) |

```js
{
  TableName: 'GitHubTable',
  KeyConditionExpression: '#pk = :pk AND #sk <= :sk',
  ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
  ExpressionAttributeValues: {
    ':pk': { S: 'REPO#alexdebrie#dynamodb-book' },
    ':sk': { S: 'REPO#alexdebrie#dynamodb-book' }
  },
  ScanIndexForward: false
}
```

Gotchas:
- The book's printed snippet for this query shows `ScanIndexForward=True` while the surrounding text says the read is descending. Descending is `false`; the equivalent Org/Teams query later in the book uses `false`. With `true` you would still get the same set of items, but the Repo arrives last instead of first, which matters once `Limit` or pagination is involved.
- The parent is always the first item returned in both directions, so application code can `shift()` it off and treat the rest as children.
- Every type that sorts on the same side of the parent is included by an open-ended `<=` / `>=`. Keep exactly one child type on each side, or add a tighter bound.

## 4. Composite sort key

A sort key value that packs two or more data elements, for example `<OrderStatus>#<OrderDate>`. (Not the same thing as a composite primary key, which just means partition key + sort key.)

**Use when both are true:**
1. An access pattern always filters on two or more attributes together.
2. One of them is enum-like (small, fixed set of values).

Design (orders by status within a date range):

| | PK | SK |
|---|---|---|
| Base table | `CustomerId` | `OrderId` |
| `OrderStatusDateGSI` | `CustomerId` | `OrderStatusDate = <OrderStatus>#<OrderDate>` |

```js
// CANCELLED orders for a customer, Jul 1 - Sep 30 2019
{
  TableName: 'CustomerOrders',
  IndexName: 'OrderStatusDateGSI',
  KeyConditionExpression: '#c = :c AND #osd BETWEEN :start AND :end',
  ExpressionAttributeNames: { '#c': 'CustomerId', '#osd': 'OrderStatusDate' },
  ExpressionAttributeValues: {
    ':c':     { S: '2b5a41c0' },
    ':start': { S: 'CANCELLED#2019-07-01T00:00:00.000000' },
    ':end':   { S: 'CANCELLED#2019-10-01T00:00:00.000000' }
  }
}
```

Rules:
- **Order of elements matters.** Items sort by the first element, then the second. Put the exact-match, low-cardinality element first and the range element last. `<OrderDate>#<OrderStatus>` is useless for this pattern: the high-cardinality date scatters statuses across the collection.
- Keep the source attributes (`OrderStatus`, `OrderDate`) as separate attributes too; the composite is an indexing attribute your application writes and must rewrite whenever either part changes.
- Because status is part of the key, `Limit: 10` returns exactly ten matching items, which a filter expression cannot promise.

## 5. Sparse indexes

An item is copied into a secondary index only if it has every attribute in that index's key schema. A sparse index deliberately leaves the key attribute(s) off items that should not appear, so the index itself is the filter. (Overloaded indexes are often technically sparse; the term here means sparseness used on purpose.)

### 5a. Filter within an entity type on a condition

Use when the matching subset is rare relative to the item collection and reading everything to discard most of it would waste read capacity. Example: admins within an organization.

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Organization | `ORG#<OrgName>` | `ORG#<OrgName>` | `ORG#<OrgName>` | `ORG#<OrgName>` |
| User (admin) | `ORG#<OrgName>` | `USER#<UserName>` | `ORG#<OrgName>` | `Admin` |
| User (non-admin) | `ORG#<OrgName>` | `USER#<UserName>` | `ORG#<OrgName>` | (absent, so not indexed) |

- "Admins in an org" is a Query on GSI1 for the org's partition; non-admins are simply not there.
- This variant coexists with index overloading: other entity types can use the same GSI1 for non-sparse patterns.
- Maintenance follows from the projection rule: set the attribute when the condition becomes true, `REMOVE` it when it becomes false, and DynamoDB adds or drops the index entry.
- Source ambiguity: the book's prose gives `ORG#<OrgName>` for both Organization index attributes, then describes Organization items as sharing a single index partition for listing all organizations. The figure is not available. If you need "list all organizations", use a fixed `GSI1PK` (for example `ORGANIZATIONS`) on Organization items rather than assuming the per-org key does it.

### 5b. Project a single entity type

Use for "give me every item of type X" (for example, all Customers for a marketing send) in a table where entity types are interleaved and a base-table Scan would read mostly irrelevant items.

| Entity | PK / SK | CustomerIndexId |
|---|---|---|
| Customer | (whatever the base design uses) | `<CustomerId>` |
| Order, InventoryItem, ... | ... | (absent) |

- Create `CustomerIndex` with `CustomerIndexId` as partition key. Only Customer items carry the attribute, so only they are projected.
- Read it with a **Scan on the index**. That scan touches only Customers.
- This does **not** combine with index overloading. The index must contain exactly one entity type, so it needs a dedicated attribute and a dedicated index.

## 6. Filter expressions

A filter expression runs **after** items are read from the partition and before they are returned. Consequences:
- You pay read capacity for every item read, including the ones filtered out.
- The 1MB page limit applies before filtering, so a page can come back with few or zero items and a `LastEvaluatedKey`.
- `Limit` counts items read, not items returned. You cannot ask for "10 SHIPPED orders" with a filter; you must overfetch or loop. If the page size is a contract, build the attribute into the key (composite sort key) so `Limit: 10` is exact.

A filter expression cannot rescue a model whose key design does not already narrow the result. Acceptable uses:

| Use | Why it is fine |
|---|---|
| Trim response payload | Less data over the wire when you would discard it anyway |
| Simpler application code | Replaces an immediate in-app `filter()`; a preference, not a necessity |
| TTL guard | TTL deletion can lag expiry by up to about 48 hours; filter out items whose expiry time has passed so business logic never sees them |

Rule of thumb for the first two: acceptable if the filter keeps at least roughly 30-40% of items read, **or** the pre-filter result is small (certainly under 1MB, ideally under ~100KB). Low hit rate on a large result set means redesign the key.

```js
// TTL guard: ignore items that are expired but not yet deleted
FilterExpression: '#ttl > :now',
ExpressionAttributeNames: { '#ttl': 'TTL' },
ExpressionAttributeValues: { ':now': { N: String(Math.floor(Date.now() / 1000)) } }
```

## 7. Client-side filtering

Fetch the narrowed set and filter/sort in application or browser code. Not a DynamoDB feature, and often the right answer.

**Use when:**
- The filter is awkward to model in keys. Example: finding open gaps in a calendar where appointments have arbitrary start times and durations. Pull the calendar for the period, compute openings in code, write back the result.
- The dataset is small (under about 1MB) and users want arbitrary combinations of filters and sorts, such as a 10-column table view with per-column conditions or full-text search. Send it all to the client.

**Do not use when** the set is not already narrowed by a partition key. One customer's orders: fine. A whole product catalog with category/price/brand facets: not fine.

---

## Sorting basics

### Type ordering

| Sort key type | Order |
|---|---|
| Number | Numeric value |
| String, Binary | UTF-8 bytes, left to right |

Only scalar string, number, and binary types can be sort keys.

UTF-8 byte order is roughly dictionary order with two traps:
1. **All uppercase letters sort before all lowercase letters.** `DeBrie` sorts before `Dean` because `B` < `a`. Normalize anything sorted alphabetically to one case in the key (`DEBRIE`, `DEAN`, `DERN`) and keep the display-cased value in a separate attribute.
2. **Digits and symbols participate.** `#` sorts before digits and letters, and `$` is the next character after `#`. Both facts are used deliberately: a `#` prefix moves an item type to the front of a collection, and `ORDER$` is an upper bound just past every `ORDER#...` key.

### Timestamps

- Must be sortable. Epoch seconds (number or fixed-width string) and ISO-8601 (`2020-03-06T15:14:15`) both work. Display formats such as `May 26, 1988` do not sort and must never be used in a key.
- ISO-8601 is preferred for readability when inspecting items. Keep one format, one timezone (UTC), and one precision across all writers, otherwise byte ordering stops matching time ordering.

### Unique, sortable IDs (KSUID)

Use when an item needs a unique, URL-friendly identifier **and** a group of those items must sort chronologically without a separate timestamp key.

- A KSUID is a timestamp prefix plus a random payload, rendered as a 27-character string. It sorts lexicographically by creation time and has more randomness than a UUIDv4.
- Example string: `1YnlHOfSSk3DhX4BR6lMAceAo1V`.
- Ordering is "roughly chronological": the timestamp has one-second resolution, so IDs created within the same second are ordered by their random part.
- Libraries exist for most languages. Adapted from the example code:

```js
const KSUID = require('ksuid')
const crypto = require('crypto')
const generateKSUID = (date) => KSUID.fromParts(date.getTime(), crypto.randomBytes(16)).string
```

| Entity | PK | SK |
|---|---|---|
| Order | `USER#<Username>` | `ORDER#<KSUID>` |

One key element now serves identity (GetItem by ID), ordering (newest first), and pagination cursor.

---

## Sorting on changing attributes

Problem: "tickets by most recently updated" tempts you to put `UpdatedAt` in the base table sort key. Primary key attributes cannot be updated, so every ticket update becomes delete-then-create, which is more code and risks data loss if the two steps are not handled atomically.

Fix: keep the base table key immutable and put the changing value in a secondary index sort key. DynamoDB performs the delete + reinsert in the index for you on every update.

| | PK | SK |
|---|---|---|
| Base table | `OrgName` | `TicketId` |
| GSI | `OrgName` | `UpdatedAt` |

Query the GSI with `ScanIndexForward: false` and a `Limit` for "most recently updated". Same shape for leaderboards (`SK = Score` on the index).

Rule: base table primary keys are built from values that never change for the life of the item. Anything mutable that needs ordering goes in an index.

---

## Ascending vs descending and parent placement

`ScanIndexForward` defaults to `true` (ascending: A to Z, oldest to newest). `false` reads descending (newest first, highest score first).

The complication: when a parent and its children share an item collection so one Query returns both, the read direction you need decides where the parent must sit.

- Reading **forward** from the parent returns the lowest-sorted children first (oldest timestamps).
- Reading **backward** from the parent returns the highest-sorted children first (newest timestamps).

So "parent + most recent N children" requires the parent to sort **after** its children.

Example: Device + 10 most recent Readings.

| Design | Device SK | Reading SK | Result of one Query with `Limit: 11` |
|---|---|---|---|
| Wrong | `DEVICE#<DeviceId>` | `READING#<Timestamp>` | Device sorts first (`D` < `R`); forward read gives Device + **oldest** readings. Reaching the newest means paginating the whole collection |
| Right | `DEVICE#<DeviceId>` | `#READING#<Timestamp>` | `#` prefix puts Readings before the Device; start at the end of the collection with `ScanIndexForward: false` to get Device + **newest** readings |

(Key values are reconstructed from the prose; the PK is the shared device key such as `DEVICE#<DeviceId>`.)

```js
{
  KeyConditionExpression: '#pk = :pk',
  ExpressionAttributeValues: { ':pk': { S: 'DEVICE#1234' } },
  ScanIndexForward: false,
  Limit: 11            // 1 Device + 10 Readings
}
```

Decision rule when co-locating children with a parent:

| Wanted child order | Parent position | Child SK | Direction |
|---|---|---|---|
| Newest / highest first | After children | `#CHILD#<sortable>` (prefix that sorts below the parent) | `false` |
| Oldest / lowest / alphabetical first | Before children | `CHILD#<sortable>` (prefix that sorts above the parent) | `true` |

Decide this before writing data. Moving a parent later means rewriting every child's sort key.

---

## Two relational access patterns in one item collection

One item collection can serve two "parent + children" patterns without a secondary index if the parent sits between the two child types and each pattern reads in a different direction.

**Requirement:** one child type is wanted in ascending order and the other in descending order, or the order of one of them does not matter.

Example: Organization with Users (alphabetical) and Teams (any order, few of them).

| Entity | PK | SK | Position |
|---|---|---|---|
| Team | `ORG#<OrgName>` | `#TEAM#<TeamName>` | Before Org (`#` prefix) |
| Organization | `ORG#<OrgName>` | `ORG#<OrgName>` | Middle |
| User | `ORG#<OrgName>` | `USER#<UserName>` | After Org |

| Access pattern | Key condition | ScanIndexForward | Child order received |
|---|---|---|---|
| Org + Teams | `PK = ORG#X AND SK <= ORG#X` | `false` | Descending by team name |
| Org + Users | `PK = ORG#X AND SK >= ORG#X` | `true` | Ascending by user name |

```js
// Org + Teams
{
  TableName: 'SaaSTable',
  KeyConditionExpression: '#pk = :pk AND #sk <= :sk',
  ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
  ExpressionAttributeValues: { ':pk': { S: 'ORG#MCDONALDS' }, ':sk': { S: 'ORG#MCDONALDS' } },
  ScanIndexForward: false
}
```

Notes:
- The `#` prefix is there purely to force the Team items ahead of the Org item; without it `TEAM` would land between `ORG` and `USER`.
- The child type read backward comes out in descending order. If both child types must come out in the same direction, either use a second collection in a GSI or see the zero-padded difference trick below.
- This is an optimization that saves an index, not a requirement. Skip it if a GSI is clearer and affordable.

---

## Zero-padding numbers

Numbers embedded in a string sort key (`<ItemType>#<Number>`) compare character by character, so `READING#10` sorts before `READING#2`. Pad to a fixed width so byte order equals numeric order.

| Raw | Padded (width 5) |
|---|---|
| `READING#2` | `READING#00002` |
| `READING#10` | `READING#00010` |

```js
const zeroPadNumber = (n) => ('0000000' + n).slice(-7)   // width 7, as in the GitHub example
```

Rules:
- Pick the width from the largest count you can imagine for one parent, then add 2-3 more digits. Extra characters are nearly free; outgrowing the width forces a rewrite of every key.
- Add an alert when any counter passes a fraction of the maximum (around 30%) so there is time to react.
- Store the unpadded number as a separate numeric attribute for display and arithmetic.

---

## Faking ascending order (zero-padded difference)

Problem: a parent has two numbered child types and both must be fetched with the parent in the **same** order (for example both newest-first). The "parent in the middle" layout gives opposite orders, so normally the second pattern needs its own item collection in a GSI.

Trick: for one child type, store `MAX - n` (zero-padded) instead of `n`. Ascending order on the stored value is descending order on the real number, so that type can sit after the parent and be read **forward** while still returning highest-numbered items first.

| Width | Real number | Zero-padded | Zero-padded difference (`99999 - n`) |
|---|---|---|---|
| 5 | 157 | `00157` | `99842` |
| 5 | 158 | `00158` | `99841` (sorts before `99842`) |

```js
const zeroPadDifference = (n) => ('0000000' + (9999999 - n)).slice(-7)   // width 7, as in the GitHub migration example
```

Layout (Device with Readings, parent first):

| Entity | PK | SK | Read |
|---|---|---|---|
| Device | `DEVICE#<DeviceId>` | `DEVICE#<DeviceId>` | Top of the collection |
| Reading | `DEVICE#<DeviceId>` | `READING#<ZeroPaddedDifference>` | `SK >= DEVICE#<DeviceId>`, `ScanIndexForward: true` returns Device, then readings from highest number to lowest |

Combined with a second child type placed before the parent using plain zero-padded numbers and read backward, both child types come back newest-first from one item collection. The GitHub migration example uses this to serve open and closed Issues/Pull Requests around a Repo in one index partition.

Caveats:
- Same width rule as zero-padding, and `MAX` is fixed forever once data exists.
- Keys become unreadable to humans; keep the real number as an attribute.
- Rarely needed. Reach for it only when it removes an index and the team accepts the obscurity.

---

## Review checklist

- Every filter in every access pattern maps to a partition key equality plus at most one sort key condition, on the table or a named index. Anything left over is justified as a filter expression (hit rate or small size) or client-side.
- No Scan-with-filter on the base table for "all items of type X"; a single-entity sparse index exists instead.
- Composite sort keys put the enum-like value first and the range value last.
- Paginated or fixed-size endpoints do not depend on a filter expression.
- String sort keys used for alphabetical order are case-normalized.
- Timestamps in keys are ISO-8601 or epoch, never display formats, with consistent precision.
- No mutable attribute (updated-at, score, status) is part of a base table primary key; it lives in an index key.
- For each "parent + children" Query, the parent's position matches the read direction, and only one child type sits on each side of the parent.
- Numbers inside string sort keys are zero-padded with headroom.
