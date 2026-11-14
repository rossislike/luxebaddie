# Worked Example: Big Time Deals (feeds, likes/watches, inbox, fan-out)

A complete single-table model for a deals app (in the style of slickdeals) with 12 item types, 3 general GSIs plus one sparse user index, and 23 access patterns. Read it when modeling "latest items" feeds (global and per-group), curated lists, like/follow counters, an inbox with an unread view, or notifications fanned out to followers or to every user.

Sources: chapter 20 of the book and the `big-time-deals-node` example (Serverless Framework, Node.js, AWS SDK v2 low-level client). Where the two disagree, both versions are given.

## Contents

1. [Requirements and ERD](#1-requirements-and-erd)
2. [Access patterns](#2-access-patterns)
3. [Final entity chart](#3-final-entity-chart)
4. [Key decisions and the strategy each applies](#4-key-decisions-and-the-strategy-each-applies)
5. [Access pattern to operation map](#5-access-pattern-to-operation-map)
6. [Code](#6-code)
7. [Where the code differs from the book](#7-where-the-code-differs-from-the-book)
8. [Defects in the example code to fix when adapting](#8-defects-in-the-example-code-to-fix-when-adapting)
9. [Reuse checklist](#9-reuse-checklist)

---

## 1. Requirements and ERD

Two audiences use the same table: external deal hunters (mobile app, read heavy) and internal editors working in a CMS (create deals, curate featured lists, send blasts). Knowing which side issues a write matters: editor writes are low volume and fully controlled, which is what makes singleton items and duplicated data safe.

| Screen | What it needs |
|---|---|
| Front Page | 5-10 featured deals picked by editors, plus an infinitely scrolling list of the latest deals site-wide |
| Brands | Alphabetical list of all brands (about 200, growing by 1-2 per month) |
| Brand page | Brand name, logo, like count, watcher count, latest deals for the brand. No featured deals (too much curation work across 200+ brands) |
| Category page | Same as a brand page plus 5-10 featured deals. Exactly eight categories, fixed |
| Deal page | One deal: title, link, price, brand, category |
| Editor's Choice | A curated list of deals, managed entirely by editors |
| Settings / Inbox | User profile, and messages newest first with two views: all, or unread only |

Messages reach an inbox in two ways: a new deal lands for a brand or category the user watches, or editors blast every user about a hot deal.

Relationships:

- User 1:N Message.
- User N:M Brand and User N:M Category, each in two flavors: Like and Watch.
- Brand 1:N Deal, Category 1:N Deal (a deal has exactly one brand and one category).
- Deal 1:1 FeaturedDeal. Category 1:N FeaturedDeal. Page (Front Page, Editor's Choice) 1:N FeaturedDeal.

What makes this model hard:

- Three "latest N" patterns over collections that grow forever, one of them read by every visitor.
- One entity (Deal) shown in many contexts: its own page, three latest lists, three featured lists.
- Two "fetch every item of type X" patterns (all brands, all users) with very different cardinality.

## 2. Access patterns

| Group | Pattern |
|---|---|
| Create core entities | Create Deal |
| | Create Brand |
| | Create Category |
| Set featured deals | For Front Page |
| | For Category |
| | For Editor's Choice page |
| Fetch page | Featured deals and latest deals for Front Page |
| | Featured deals and latest deals for Category |
| | Featured deals for Editor's Choice page |
| | Latest deals for Brand (with the Brand item) |
| | All Brands |
| | Deal |
| Users and interactions | Create User |
| | Like Brand for User |
| | Watch Brand for User |
| | Like Category for User |
| | Watch Category for User |
| Messages | View Messages for User |
| | View Unread Messages for User |
| | Mark Message as Read |
| | Send Hot New Deal Message to all Users |
| | Send new Brand Deal Message to Brand Watchers |
| | Send new Category Deal Message to Category Watchers |

## 3. Final entity chart

Composite primary key (`PK`, `SK`), on-demand billing, stream enabled. Key patterns below are the book's; code deviations are listed in section 7.

| Entity | PK | SK |
|---|---|---|
| Deal | `DEAL#<DealId>` | `DEAL#<DealId>` |
| Brand | `BRAND#<Brand>` | `BRAND#<Brand>` |
| Brands (singleton) | `BRANDS` | `BRANDS` |
| BrandLike | `BRANDLIKE#<Brand>#<Username>` | `BRANDLIKE#<Brand>#<Username>` |
| BrandWatch | `BRANDWATCH#<Brand>` | `USER#<Username>` |
| Category | `CATEGORY#<Category>` | `CATEGORY#<Category>` |
| CategoryLike | `CATEGORYLIKE#<Category>#<Username>` | `CATEGORYLIKE#<Category>#<Username>` |
| CategoryWatch | `CATEGORYWATCH#<Category>` | `USER#<Username>` |
| FrontPage (singleton) | `FRONTPAGE` | `FRONTPAGE` |
| Editor's Choice (singleton) | `EDITORSCHOICE` | `EDITORSCHOICE` |
| User | `USER#<Username>` | `USER#<Username>` |
| Message | `MESSAGES#<Username>` | `MESSAGE#<MessageId>` |
| DealsCache (optional, book only) | `DEALSCACHE#<CacheNumber>` | `DEALSCACHE#<CacheNumber>` |

| Index | Entity | Partition key | Sort key | Purpose |
|---|---|---|---|---|
| GSI1 | Deal | `GSI1PK = DEALS#<TruncatedTimestamp>` | `GSI1SK = DEAL#<DealId>` | Latest deals site-wide |
| GSI1 | Message, unread only | `GSI1PK = MESSAGES#<Username>` | `GSI1SK = MESSAGE#<MessageId>` | Unread inbox (sparse) |
| GSI2 | Deal | `GSI2PK = BRAND#<Brand>#<TruncatedTimestamp>` | `GSI2SK = DEAL#<DealId>` | Latest deals for a brand |
| GSI3 | Deal | `GSI3PK = CATEGORY#<Category>#<TruncatedTimestamp>` | `GSI3SK = DEAL#<DealId>` | Latest deals for a category |
| UserIndex | User | `UserIndex = USER#<Username>` | none | Sparse index holding only users, read with Scan |

Non-key attributes that carry design weight: `LikeCount` and `WatchCount` on Brand and Category; `Brands` (string set) on the singleton; `FeaturedDeals` on Category, FrontPage, and Editor's Choice; `Unread` on Message; `Type` on every item (the stream handler filters on it).

`DealId` and `MessageId` are KSUIDs: 27-character IDs that are unique like a UUID but sort chronologically as strings, so `DEAL#<DealId>` as a sort key is a time ordering without a separate timestamp key.

## 4. Key decisions and the strategy each applies

### 4.1 Latest deals: shard the feed by truncated timestamp

**Problem.** The usual "latest items" design puts all items under one partition key and sorts by time. That works when a natural parent (a user, an org) bounds the collection. Here the collection is every deal ever created, so one item collection would grow without limit.

**Rejected.** Random write shards (`DEALS#<0..N>`) with scatter-gather: every read must hit all N partitions and merge the results to rebuild time order.

**Chosen.** Shard by time bucket. Each deal gets `GSI1PK = DEALS#<timestamp truncated to the bucket>`, and the KSUID sort key orders deals inside the bucket. Buckets are themselves ordered, so a reader walks back from the current bucket and never has to merge.

**Bucket size rule.** Pick the truncation (hour, day, week, month) from write rate so a bucket holds a comfortable number of items and one page is normally served by one bucket. The example assumes about 100 deals per day and truncates to the day. Example: `2020-02-14 12:52:14` truncated to the day is `2020-02-14 00:00:00`; to the month, `2020-02-01 00:00:00`.

**Read walk.** A page size of 25 cannot be guaranteed from one bucket (early in the day, or when paging near the end of a bucket). The read is a loop:

1. Query the current bucket, newest first (`ScanIndexForward=false`), `Limit` = items still needed. When paging, add `GSI1SK < DEAL#<LastDealIdSeen>` on the first bucket queried.
2. If the page is still short, step the date back one bucket and query again for the remainder.
3. Stop when the page is full or after a fixed number of buckets (5 in the example). The cap is essential: with fewer total items than a page, an uncapped walk would query empty buckets forever.

Normally this is one request and rarely more than two. For paging, the client sends back the last deal ID it saw; because a KSUID embeds its timestamp, the server can also derive which bucket to resume in from that ID (an inference from the key design, the book only names `LastDealIdSeen` as the parameter).

**When not to use.** If the feed has a bounded natural parent, keep the single item collection. If writes are sparse relative to the bucket, widen the bucket or the walk will burn its cap on empty partitions and return short pages.

### 4.2 Latest deals for a brand or category: same sharding, give up the pre-join

The pattern is "fetch the Brand and its latest deals", which normally suggests putting the parent and children in one item collection so one Query returns both. That conflicts with time sharding: deals for a brand are spread across many `BRAND#<Brand>#<bucket>` partitions and the Brand item can live in only one.

Choice: keep the sharding and issue two requests, a GetItem for the Brand (or Category) and the bucket-walk Query on GSI2 (or GSI3). Reasons: partition size is still the bigger risk, and the two requests are independent, so they run in parallel (`Promise.all` in the code) with no waterfall.

Rule: a pre-join is worth giving up when the child collection is unbounded and the second request can be parallel.

The same bucket is reused for all three indexes. A single brand has far fewer deals per day than the whole site, so brand and category walks are more likely to cross several buckets and hit the cap; a coarser bucket per index is a reasonable tuning (not from the book).

### 4.3 Hot partition on the newest bucket: precompute and replicate a cache item

Size is solved by sharding; read heat is not. Every front page view reads the newest bucket, so one partition takes most of the read traffic.

The access pattern is predictable (everyone wants the same newest deals), so it is cacheable. When an editor adds a deal, a stream-triggered function queries the last two days of deals and stores the result:

- In an external cache such as Redis, or
- In DynamoDB itself as N identical items `DEALSCACHE#<1..N>` (PK and SK the same), each holding the full list in a `Deals` attribute. Readers pick a random number in 1..N and do one GetItem, spreading reads over N partitions so no single one hits the per-partition read ceiling (the book cites 3000 RCU).

To scale, write more copies and widen the random range on the read path. The same replication trick applies to any hot singleton (Brands list, Front Page, Editor's Choice).

This is an optional add-on, easy to bolt on later, and is not part of the entity chart. **The example code does not implement it**: the front page reads GSI1 directly.

### 4.4 Singleton items: Brands list, Front Page, Editor's Choice

**All brands.** Putting every Brand in one item collection to list them is normally a bad idea (one fat partition). But the list view needs only names, there are about 200 of them, and creation is fully controlled by editors. So one container item `PK = SK = BRANDS` holds a string-set attribute `Brands`. Listing is one GetItem. Individual `BRAND#<Brand>` items still hold logo and counters.

Creating a brand therefore writes two items, and the code does it in one transaction: Put the Brand with `attribute_not_exists(PK)`, and `ADD` the name to the set on the container (which also creates the container on first use).

**Featured lists.** Front Page and Editor's Choice are singleton items (`FRONTPAGE`, `EDITORSCHOICE`) whose `FeaturedDeals` attribute holds a full copy of each featured deal's display data. The alternative (flag attributes on Deal plus a sparse index) is heavier than needed for 5-10 items.

**Featured deals per category.** Same idea, but the list lives on the Category item itself as a complex attribute, with deal data duplicated from the Deal items. This combines the two denormalization strategies for one-to-many relationships: complex attribute plus duplication.

**Why duplication is acceptable.** The list is small and bounded, and the only writer is the CMS, which sends the complete list with full deal details every time. The write is a whole-attribute replace, so there is no partial-update logic.

**When not to use a singleton.** When the member count is unbounded (see users, 4.7) or writers are not under your control: the 400KB item limit and write contention on one item both bite.

### 4.5 Likes: one item per like for uniqueness, a counter on the parent, one transaction

Two requirements: a user may like a brand only once, and the brand page shows the like count.

- A set of usernames on the Brand item fails because the number of likers is unbounded and items cap at 400KB.
- So each like is its own item with both identifiers in the key: `BRANDLIKE#<Brand>#<Username>`. A Put with `attribute_not_exists(PK)` rejects a second like.
- Counting like items on every page view is wasteful, so the Brand keeps a `LikeCount` attribute.
- Both writes must succeed or fail together, so they go in one `TransactWriteItems`: the conditional Put of the like, and an Update on the Brand that increments the counter with `attribute_exists(PK)` so a like for a nonexistent brand fails. If the like already exists the counter is untouched; if the brand is missing no like is recorded.

Category likes are identical with `CATEGORYLIKE#...` and the Category item.

General strategy: **reference counts via transaction** = uniqueness item + conditional counter increment on the parent, atomically.

### 4.6 Watches: same transaction, different key, because watchers must be listed

A watch is a like with one extra requirement: the system must find all watchers of a brand to notify them. Nobody ever lists likers, so a like can be an isolated item. Watches must share an item collection:

- `PK = BRANDWATCH#<Brand>`, `SK = USER#<Username>`.

The username moves from the partition key to the sort key. Uniqueness still holds (same PK + SK means same item), the transaction is unchanged apart from incrementing `WatchCount`, and `Query PK = BRANDWATCH#<Brand>` returns every watcher.

Rule: decide where an identifier goes in the key by asking whether you ever need to enumerate the items. If yes, it belongs in the sort key under a shared partition key.

Not covered by either source: unlike and unwatch. The reverse would be a transaction that deletes the interaction item with `attribute_exists(PK)` and decrements the counter. Also not covered: "which brands does this user watch", which the keys above cannot answer without another index.

### 4.7 Finding all users: sparse index holding one entity type, read with Scan

"Message every user" is two steps: enumerate users, then write a message for each.

| Option | Verdict |
|---|---|
| Singleton item listing usernames | No. User count is unbounded and should exceed 400KB |
| Static partition key (for example `USERS`) in an index | No. Every user write lands in one index partition, a hot key |
| Sparse index that contains only User items, read with Scan | Yes |

Each User item carries `UserIndex = USER#<Username>`. A GSI keyed on that attribute alone contains only users, because no other item type has the attribute. Scanning that index reads exactly the users and nothing else, and its keys are well distributed.

Distinction worth keeping: GSI1-3 happen to be sparse too (only some items have those attributes), but they are general-purpose and may take more entity types later. `UserIndex` relies on sparseness as its filter, so no other entity may ever write that attribute.

Parallel scan: neither chapter 20 nor the example code uses one. Both do a plain sequential Scan of `UserIndex`. The book covers parallel scans (`TotalSegments` and `Segment`, one worker per segment) in its migrations chapter; splitting this scan across workers that way is the natural extension for a large user base, but it is not shown for this example.

### 4.8 Unique usernames

The User item is keyed by username and created with `attribute_not_exists(PK)`, so a second signup with the same name fails with a conditional check error. Only one attribute needs to be unique here, so a single conditional Put is enough (no transaction and no extra tracking item).

### 4.9 Inbox: sparse index to filter within one entity type

Messages live in the user's item collection: `PK = MESSAGES#<Username>`, `SK = MESSAGE#<MessageId>` with a KSUID, so a reverse Query returns newest first.

"All messages" and "unread messages" are the same pattern with an optional filter. Options considered:

| Option | Verdict |
|---|---|
| Separate partitions for read and unread | No. "All messages" would need two reads and merging, and exact page sizes get hard |
| Read state in the sort key (composite sort key) | No. That suits a filter that is always applied; here it is applied only sometimes |
| Filter expression or client-side filtering | Works, but overfetches. Reserve for cases with many different filter combinations |
| Sparse index | Yes. Exactly one filter to support |

Unread messages get `GSI1PK`/`GSI1SK` equal to their primary key values; read messages do not have those attributes. GSI1 therefore contains only unread messages for each user.

- Create: the data layer always writes `Unread = true` plus the GSI1 attributes. Callers do not think about indexing.
- Mark read: one UpdateItem that sets `Unread` to false and `REMOVE`s `GSI1PK` and `GSI1SK`, which drops the item from the index.
- Read: one function for both views. Same key condition; the unread view adds `IndexName = GSI1` (and names the GSI1 partition key attribute).

GSI1 is shared with the deals feed. That is safe because the partition key prefixes differ (`DEALS#...` vs `MESSAGES#...`), which is index overloading.

### 4.10 Notifying watchers: DynamoDB Streams plus fan-out

Creating a deal must not get slower because thousands of people watch the brand. The write path only puts the Deal; a Lambda subscribed to the table's stream does the fan-out:

1. Keep only records that are inserts of Deal items.
2. For each new deal, Query the `BRANDWATCH#<Brand>` partition and the `CATEGORYWATCH#<Category>` partition, following pagination.
3. For each watcher returned, create a Message item in that user's inbox.

Strategy: reactive work goes behind the stream so hot write paths stay a single small write. Consequence: delivery is asynchronous and inbox messages appear shortly after the deal, not atomically with it.

### 4.11 Blasting all users

Same shape as watcher fan-out with a different source of recipients: Scan `UserIndex` page by page, and write one Message per user per page. In the example code this is triggered by an editor HTTP request (`POST /hotdealblast` with subject, message, deal ID), not by the stream, and runs inline in that request.

### 4.12 Smaller decisions

- **Composite primary key.** 23 patterns with relationships rule out a simple key.
- **No "all categories" pattern.** Eight fixed categories are hardcoded in the app, so there is no `CATEGORIES` singleton and no create-category endpoint in the code.
- **Start with the central entity.** There is no entity that parents several one-to-many relationships, so modeling starts with Deal, the entity that appears in the most contexts.

## 5. Access pattern to operation map

Key values are shown in the book's format.

| Access pattern | Target | Operation and key condition | Notes |
|---|---|---|---|
| Create Deal | Table | `PutItem`, `attribute_not_exists(PK)` | Item carries GSI1, GSI2, GSI3 keys. CMS only |
| Create Brand | Table | `TransactWriteItems`: Put `BRAND#<Brand>` with `attribute_not_exists(PK)`; Update `BRANDS` with `ADD Brands :name` | Keeps the singleton in step with brand items |
| Create Category | Table | `PutItem` on `CATEGORY#<Category>` | Fixed set of 8. Code has only an upsert (see 8) |
| Set Featured Deals, Front Page | Table | `PutItem` on `FRONTPAGE` | Send the full list every time |
| Set Featured Deals, Category | Table | Write `FeaturedDeals` on `CATEGORY#<Category>` | Send the full list every time |
| Set Featured Deals, Editor's Choice | Table | `PutItem` on `EDITORSCHOICE` | Send the full list every time |
| Fetch Front Page and latest deals | Table + GSI1 | `GetItem` `FRONTPAGE`, in parallel with `Query` GSI1 `GSI1PK = DEALS#<bucket>` [`AND GSI1SK < DEAL#<LastDealIdSeen>`], `ScanIndexForward=false`, `Limit` = remaining | Walk back bucket by bucket, up to 25 deals, capped |
| Fetch Category and latest deals | Table + GSI3 | `GetItem` `CATEGORY#<Category>`, in parallel with `Query` GSI3 `GSI3PK = CATEGORY#<Category>#<bucket>` | Same walk |
| Fetch Editor's Choice page | Table | `GetItem` `EDITORSCHOICE` | |
| Fetch latest deals for Brand | Table + GSI2 | `GetItem` `BRAND#<Brand>`, in parallel with `Query` GSI2 `GSI2PK = BRAND#<Brand>#<bucket>` | Same walk |
| Fetch all Brands | Table | `GetItem` `BRANDS` | Names only |
| Fetch Deal | Table | `GetItem` `DEAL#<DealId>` | |
| Create User | Table | `PutItem`, `attribute_not_exists(PK)` | Username uniqueness. Sets `UserIndex` |
| Like Brand for User | Table | `TransactWriteItems`: Put `BRANDLIKE#<Brand>#<Username>` if not exists; Update Brand `SET LikeCount = LikeCount + 1` if exists | Code adds a ConditionCheck that the user exists |
| Watch Brand for User | Table | Same, Put `BRANDWATCH#<Brand>` / `USER#<Username>`; increment `WatchCount` | |
| Like Category for User | Table | Same against `CATEGORYLIKE#...` and the Category item | |
| Watch Category for User | Table | Same against `CATEGORYWATCH#<Category>` / `USER#<Username>` | |
| View Messages for User | Table | `Query` `PK = MESSAGES#<Username>`, `ScanIndexForward=false` | |
| View Unread Messages for User | GSI1 | `Query` `GSI1PK = MESSAGES#<Username>`, `ScanIndexForward=false` | Sparse index |
| Mark Message as Read | Table | `UpdateItem` `SET Unread = false REMOVE GSI1PK, GSI1SK` | Code adds `attribute_exists(PK)` |
| Send Hot New Deal Message to all Users | UserIndex, then table | `Scan` `UserIndex` (paginated); `BatchWriteItem` Message puts, 25 per call | |
| Send new Brand Deal Message to watchers | Stream, then table | On Deal insert: `Query` `PK = BRANDWATCH#<Brand>` (paginated); `BatchWriteItem` Message puts | |
| Send new Category Deal Message to watchers | Stream, then table | On Deal insert: `Query` `PK = CATEGORYWATCH#<Category>` (paginated); `BatchWriteItem` Message puts | |

## 6. Code

Adapted from `big-time-deals-node`. Layout: `entities/` (classes with `key()`, `gsiN()`, `toItem()`, and `xFromItem` parsers), `data/` (one module per access pattern), `handlers/` (Lambda entry points that validate input and call `data/`). All key construction lives in the entity classes, so no handler ever builds a key string.

### 6.1 Table definition (serverless.yml, CloudFormation)

```yaml
BigTimeDealsTable:
  Type: AWS::DynamoDB::Table
  Properties:
    AttributeDefinitions:          # all type S
      - { AttributeName: PK, AttributeType: S }
      - { AttributeName: SK, AttributeType: S }
      - { AttributeName: GSI1PK, AttributeType: S }
      - { AttributeName: GSI1SK, AttributeType: S }
      - { AttributeName: GSI2PK, AttributeType: S }
      - { AttributeName: GSI2SK, AttributeType: S }
      - { AttributeName: GSI3PK, AttributeType: S }
      - { AttributeName: GSI3SK, AttributeType: S }
      - { AttributeName: UserIndex, AttributeType: S }
    KeySchema:
      - { AttributeName: PK, KeyType: HASH }
      - { AttributeName: SK, KeyType: RANGE }
    BillingMode: PAY_PER_REQUEST
    StreamSpecification:
      StreamViewType: NEW_IMAGE    # handler only needs the inserted item
    GlobalSecondaryIndexes:
      - IndexName: GSI1
        KeySchema:
          - { AttributeName: GSI1PK, KeyType: HASH }
          - { AttributeName: GSI1SK, KeyType: RANGE }
        Projection: { ProjectionType: ALL }
      # GSI2 and GSI3 are identical with GSI2PK/GSI2SK and GSI3PK/GSI3SK
      - IndexName: UserIndex       # sparse, partition key only
        KeySchema:
          - { AttributeName: UserIndex, KeyType: HASH }
        Projection: { ProjectionType: ALL }
```

The stream function is wired with an event source on the table's `StreamArn`. IAM grants `Query`/`Scan`/`GetItem`/`PutItem`/`UpdateItem`/`BatchWriteItem`/`ConditionCheckItem` on the table and each index ARN (`<tableArn>/index/GSI1` and so on), plus `DescribeStream`/`GetRecords`/`GetShardIterator`/`ListStreams` on `<tableArn>/stream/*`. Transactions that use a `ConditionCheck` need the `ConditionCheckItem` permission.

### 6.2 Key helpers

```js
const generateKSUID = timestamp =>
  KSUID.fromParts(timestamp.getTime(), crypto.randomBytes(16)).string

// Truncate to the day. Built from local-time parts: correct only when the
// runtime is in UTC (Lambda is). Use Date.UTC(...) to be explicit.
const truncateTimestamp = ts =>
  new Date(ts.getFullYear(), ts.getMonth(), ts.getDate())

const dealGSI1PK = ts => ({ S: `DEALS#${truncateTimestamp(ts).toISOString()}` })

class Deal {
  // dealId defaults to generateKSUID(createdAt)
  key()  { return { PK: { S: `DEAL#${this.dealId}` }, SK: { S: `DEAL#${this.dealId}` } } }
  gsi1() { return { GSI1PK: dealGSI1PK(this.createdAt), GSI1SK: { S: `DEAL#${this.dealId}` } } }
  gsi2() { return {
    GSI2PK: { S: `BRAND#${this.brand.toUpperCase()}#${truncateTimestamp(this.createdAt).toISOString()}` },
    GSI2SK: { S: `DEAL#${this.dealId}` } } }
  gsi3() { return {
    GSI3PK: { S: `CATEGORY#${this.category.toUpperCase()}#${truncateTimestamp(this.createdAt).toISOString()}` },
    GSI3SK: { S: `DEAL#${this.dealId}` } } }
  toItem() { return { ...this.key(), ...this.gsi1(), ...this.gsi2(), ...this.gsi3(),
    Type: { S: 'Deal' }, DealId: { S: this.dealId }, /* Title, Link, Price, Category, Brand, CreatedAt */ } }
}

class Message {
  pk()  { return { S: `MESSAGES#${this.username.toLowerCase()}` } }
  key() { return { PK: this.pk(), SK: { S: `MESSAGES#${this.messageId}` } } }
  gsi1() {                      // sparse: present only while unread
    if (!this.unread) return {}
    return { GSI1PK: this.pk(), GSI1SK: { S: `MESSAGES#${this.messageId}` } }
  }
}

class User {
  key()       { const k = { S: `USER#${this.username.toLowerCase()}` }; return { PK: k, SK: k } }
  userIndex() { return { UserIndex: { S: `USER#${this.username.toLowerCase()}` } } }  // sparse index key
}

// Likes: both ids in PK and SK. Watches: shared PK, user in SK.
class Like  { key() { const k = { S: `${TYPE}#${name}#${username}` }; return { PK: k, SK: k } } }
class Watch {
  pk()  { return { S: `${TYPE}#${name}` } }                 // e.g. BRANDWATCH#apple
  key() { return { PK: this.pk(), SK: { S: `USER#${username}` } } }
}
```

The same `gsi2pk(timestamp)` and `gsi3pk(timestamp)` builders also exist on the `Brand` and `Category` classes; the read path uses those to compute the partition for each bucket.

### 6.3 Like / watch transaction

```js
const params = { TransactItems: [
  { Put: {                                   // uniqueness: one like per user per brand
      TableName, Item: brandLike.toItem(),
      ConditionExpression: 'attribute_not_exists(PK)' } },
  { Update: {                                // reference count on the parent
      TableName, Key: brand.key(),
      ConditionExpression: 'attribute_exists(PK)',
      UpdateExpression: 'SET #likeCount = #likeCount + :inc',
      ExpressionAttributeNames: { '#likeCount': 'LikeCount' },
      ExpressionAttributeValues: { ':inc': { N: '1' } } } },
  { ConditionCheck: {                        // code only: the user must exist
      TableName, Key: user.key(),
      ConditionExpression: 'attribute_exists(PK)' } },
] }
```

Watching is the same with `brandWatch.toItem()` and `WatchCount`. Categories swap in the Category key.

Error mapping: on `TransactionCanceledException`, the cancellation reasons array is positional, so index 0 failing means "already liked", index 1 "brand does not exist", index 2 "user does not exist". SDK v2 does not expose the reasons on the error, so the code wraps the call and parses `CancellationReasons` out of the raw HTTP response in an `extractError` listener. `SET x = x + :inc` requires the attribute to exist already, which is why Brand and Category items are created with both counters at 0.

### 6.4 Multi-partition latest-deals read

```js
const getLatestDeals = async ({ createdAt = new Date(), limit = 25, count = 0 }) => {
  let deals = []
  const resp = await dynamodb.query({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: '#gsi1pk = :gsi1pk',
    ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK' },
    ExpressionAttributeValues: { ':gsi1pk': dealGSI1PK(createdAt) },
    ScanIndexForward: false,           // newest first within the bucket
    Limit: limit
  }).promise()
  resp.Items.forEach(item => deals.push(dealFromItem(item)))

  if (deals.length < limit && count < 5) {   // short page: go back one day
    const { deals: more } = await getLatestDeals({
      createdAt: new Date(createdAt.setDate(createdAt.getDate() - 1)),
      limit: limit - deals.length,           // only ask for the remainder
      count: count + 1                       // cap on empty buckets
    })
    deals = deals.concat(more)
  }
  return { deals }
}

// Parent item and feed are fetched in parallel, not as a waterfall
const [page, latest] = await Promise.all([getFrontPage(), getLatestDeals({})])
```

Brand and category versions are identical except for `IndexName` (`GSI2`, `GSI3`) and the partition key (`brand.gsi2pk(createdAt)`, `category.gsi3pk(createdAt)`).

To page (book design, absent from the code), accept `LastDealIdSeen` and add a sort key condition on the first bucket queried only: `#gsi1pk = :pk AND #gsi1sk < :sk` with `:sk = DEAL#<LastDealIdSeen>`.

### 6.5 Sparse-index inbox

```js
// One function, two views
const params = {
  TableName, KeyConditionExpression: '#pk = :pk',
  ExpressionAttributeNames: { '#pk': 'PK' },
  ExpressionAttributeValues: { ':pk': message.pk() },
  ScanIndexForward: false
}
if (unread) {
  params.IndexName = 'GSI1'
  params.ExpressionAttributeNames = { '#pk': 'GSI1PK' }
}

// Mark read: flip the flag and drop out of the sparse index in one write
await dynamodb.updateItem({
  TableName, Key: message.key(),
  ConditionExpression: 'attribute_exists(PK)',
  UpdateExpression: 'SET #unread = :false REMOVE #gsi1pk, #gsi1sk',
  ExpressionAttributeNames: { '#unread': 'Unread', '#gsi1pk': 'GSI1PK', '#gsi1sk': 'GSI1SK' },
  ExpressionAttributeValues: { ':false': { S: 'false' } }
}).promise()
```

### 6.6 Stream handler and fan-out

```js
exports.handler = async event => {
  const deals = event.Records
    .filter(r => r.eventName === 'INSERT' && r.dynamodb.NewImage.Type.S === 'Deal')
    .map(r => dealFromItem(r.dynamodb.NewImage))

  await Promise.all([
    ...deals.map(deal => notifyBrandWatchers({ deal })),
    ...deals.map(deal => notifyCategoryWatchers({ deal }))
  ])
}
```

Fan-out for one deal, with the code's defects (section 8) corrected:

```js
const notifyBrandWatchers = async ({ deal }) => {
  const params = {
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: '#pk = :pk',
    ExpressionAttributeNames: { '#pk': 'PK' },
    ExpressionAttributeValues: { ':pk': new BrandWatch({ name: deal.brand }).pk() }
  }
  do {
    const page = await dynamodb.query(params).promise()
    const puts = page.Items.map(item => ({ PutRequest: { Item: new Message({
      username: item.Username.S,
      subject: `New Deal arrived in ${deal.brand}!`,
      message: `Check out this hot new deal for ${deal.brand}: ${deal.title}`,
      dealId: deal.dealId
    }).toItem() } }))
    for (let i = 0; i < puts.length; i += 25) {          // BatchWriteItem max is 25
      let pending = puts.slice(i, i + 25)
      for (let attempt = 0; pending.length && attempt < 5; attempt++) {
        const res = await dynamodb.batchWriteItem({
          RequestItems: { [process.env.TABLE_NAME]: pending } }).promise()
        pending = res.UnprocessedItems[process.env.TABLE_NAME] || []   // retry only leftovers
      }
    }
    params.ExclusiveStartKey = page.LastEvaluatedKey
  } while (params.ExclusiveStartKey)
}
```

The all-users blast is the same loop with the Query replaced by `dynamodb.scan({ TableName, IndexName: 'UserIndex' })`.

## 7. Where the code differs from the book

| Topic | Book | Code |
|---|---|---|
| Editor's Choice key | `EDITORSCHOICE` | `EDITORPAGE` |
| Message sort key (and GSI1SK) | `MESSAGE#<MessageId>` (KSUID). The book's own snippets instead use `MESSAGE#<username>` / `MESSAGE#<created_at>` | `MESSAGES#<MessageId>` |
| Like / watch transaction | Two operations | Three: adds a `ConditionCheck` that the User exists |
| Counter attribute | `LikesCount` in the snippet, `LikeCount` in the summary table | `LikeCount`, `WatchCount` |
| Key casing | Not specified | Brand and Category keys upper-case the name; like and watch keys lower-case the name and username (`BRANDLIKE#apple#alexdebrie`, `BRANDWATCH#apple`); user and message keys lower-case the username |
| Truncated timestamp format | `2020-02-14T00:00:00` | `toISOString()`, for example `2020-02-14T00:00:00.000Z` |
| Feed pagination | `LastDealIdSeen` parameter with a `SK <` condition | None. Always returns the newest 25 |
| Feed walk | Iterative loop, at most 5 buckets | Recursive, the initial bucket plus up to 5 more (6 queries worst case); each step requests only the remainder |
| Hot-partition cache | Described as optional (Redis or `DEALSCACHE#<n>` items written from the stream) | Not implemented |
| Featured deals storage | Complex attribute | JSON string in an `S` attribute (`JSON.stringify`) on Category and Page items |
| Create Brand | "Add to BRANDS container" | Transaction: conditional Put of Brand + `ADD` to the `Brands` string set |
| Create Category | Listed as a pattern | No create endpoint; `POST /categories/{name}` is a full-item `PutItem` used to set featured deals. Names validated against a hardcoded list of eight |
| Mark message read | `SET` + `REMOVE` | Adds `attribute_exists(PK)`; `Unread` stored as the string `'true'`/`'false'` |
| Unread query | Only adds `IndexName` | Also switches the key attribute name to `GSI1PK` |
| Writing fan-out messages | One write per recipient implied | `BatchWriteItem` in chunks of 25 with a retry loop |
| Blast trigger | Not specified | Synchronous HTTP endpoint that scans and writes inline |
| Parallel scan | Not in this chapter (covered in the migrations chapter) | Not used. Sequential Scan |
| Stream view type | Not specified | `NEW_IMAGE`; handler filters `INSERT` and `Type = 'Deal'` |

Errors in the book's snippets to avoid copying:

- The feed query names `PK`/`SK` although it targets GSI1; it must use `GSI1PK`/`GSI1SK`. The same slip appears in the unread-messages query.
- The feed query's default "last seen" sentinel is `$`, giving `SK < DEAL#$`. `$` sorts below every character a KSUID can contain, so as written the first page would match nothing. Omit the sort key condition on the first page, or use a sentinel that sorts above the ID alphabet. (This reading is an inference from ASCII ordering, not something the book states.)
- The walk-back loop passes its bucket counter in the position of the limit argument and returns 24 items instead of 25.
- The mark-read expression is written `SET #unread = :false, REMOVE #gsi1pk, gsi1sk`. Valid syntax has no comma between clauses and needs the `#` placeholder on both names.
- The access pattern table lists "Brand" as the parameter for Fetch Deal; the operation is a GetItem by deal ID.

## 8. Defects in the example code to fix when adapting

These are in the repository as shipped. None of them changes the data model, but all would surface in production.

- **Fan-out pagination never advances.** The loops set `exclusiveStartKey` (lower-case e) on the request. The parameter is `ExclusiveStartKey`. This affects both watcher notifications and the all-users scan as soon as results exceed one 1MB page.
- **Batch retry is broken.** The retry counter is declared `const` and then incremented; unprocessed items are read from `UnprocessedItems.PutRequest`, but that map is keyed by table name, so leftovers are never detected; and a retry would resend the whole batch, not the leftovers.
- **Setting a category's featured deals resets its counters.** The update is a full `PutItem` of a Category built with default counts, so `LikeCount` and `WatchCount` go back to 0. Use `UpdateItem SET FeaturedDeals = :f` instead. The page singletons are safe because they hold nothing else.
- **Fan-out errors are swallowed.** The stream handler and notify functions log and return, so the batch is reported as successful and failed notifications are never retried.
- **Fan-out is not idempotent.** Message IDs are generated at send time, so a retried stream batch would write duplicate messages. Deriving the message ID from the deal ID and recipient would make a retry overwrite instead (suggestion, not from the sources).
- **No unlike or unwatch**, and no check that a deal's brand exists when a deal is created.
- **Bucket boundaries use local time** (see 6.2). Writers and readers must agree on the timezone or deals land in buckets the reader never queries.

## 9. Reuse checklist

| If your app has | Apply |
|---|---|
| A "latest N" feed over an unbounded, parentless collection | Time-bucketed partition key + time-sortable ID as sort key; capped walk back across buckets (4.1) |
| The same feed scoped to a group | `<GROUP>#<id>#<bucket>` in another GSI; fetch the parent item in parallel (4.2) |
| A feed partition everyone reads | Precompute the page on write via the stream; store N identical cache items and read a random one (4.3) |
| A small, editor-controlled list | Singleton item with a set or duplicated list (4.4) |
| "Do X at most once per user" plus a visible count | Uniqueness item + counter increment in one transaction (4.5) |
| The same, but members must be enumerated | Move the user ID into the sort key under a shared partition (4.6) |
| "Every item of type X", unbounded | Sparse single-entity index + Scan, never a static partition key (4.7) |
| A list with one optional boolean filter | Sparse index: add index keys while the flag is on, `REMOVE` them when it goes off (4.9) |
| Side effects for many recipients on a write | Stream consumer that enumerates recipients and batch-writes one item each (4.10, 4.11) |
