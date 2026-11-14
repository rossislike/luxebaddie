# DynamoDB Fundamentals: Properties, Vocabulary, Partitions, Consistency, Limits

The mental model and hard constraints that every DynamoDB design decision rests on. Read this when deciding whether DynamoDB fits a workload, when you need the exact meaning of a term (item collection, LSI vs GSI, overloaded key), or when a design might run into a consistency rule or a service limit.

---

## Mental model

DynamoDB is a key-value store that can also act as a wide-column store.

- **Key-value view:** a huge distributed hash table. Each record is addressed by its key, and get/put/update/delete cost the same no matter how big the table is. Limitation: one record per lookup.
- **Wide-column view:** a hash table whose values are B-trees. The partition key picks the B-tree (O(1)); the sort key orders entries inside it, which allows range reads (O(log n) to find the start, then a sequential read).
- **Analogy:** a bookshelf of phone books, one per city. The shelf is the hash table, each phone book is a B-tree. "All entries between Buffett and DeBrie in Omaha" means: pick the Omaha book, then read one contiguous range.

Data modeling in DynamoDB is the work of putting the right "books" on the shelf with entries in the right order, so that every access pattern is either a single-key lookup or one contiguous range read.

---

## Key properties

| Property | What it means for design |
|---|---|
| **Key-value / wide-column model** | No joins, no ad hoc queries. Access is driven by primary keys, so access patterns must be known before the table is designed. |
| **Scaling without performance degradation** | Most operations return in single-digit milliseconds whether the table is 10GB or 100TB+. There is no practical table size limit. DAX (managed in-memory cache) exists if you need faster reads. |
| **HTTP connection model** | Every request is an HTTP call. No connection pool to initialize, no cap on concurrent connections (as long as throughput is paid for). Slightly slower per request than a warm TCP connection, but ideal for short-lived compute. |
| **IAM authentication** | No database users or passwords. Compute roles get IAM policies, which can restrict by action (for example `GetItem` only), by table, and even by primary key values or visible attributes. |
| **Infrastructure-as-code friendly** | Table, primary key, secondary indexes, and access control are all declarative (CloudFormation, Terraform). No out-of-band admin steps such as creating users or running schema migrations. |
| **Flexible pricing** | You pay for workload, not for server size. Read and write throughput are set independently and can be scaled up and down. |
| **Streams** | Built-in change data capture: a log of every item write that other code can consume. |
| **Fully managed** | No servers, failover, backups, or upgrades to operate. The tradeoff is less control (no SSH, few config knobs). |

### Capacity units and billing modes

- **Read Capacity Unit (RCU):** one strongly consistent read per second, or two eventually consistent reads per second, for an item up to 4KB.
- **Write Capacity Unit (WCU):** one write per second for an item up to 1KB.
- **Provisioned mode:** you set RCUs and WCUs (and can adjust them over time, for example lower at night). Cheaper per request when traffic is predictable.
- **On-demand mode:** pay per request, no capacity planning. Higher per-request price, but can be cheaper for spiky traffic that would leave provisioned capacity idle.
- You can switch between modes. Recommended path: start on-demand, establish a traffic baseline, then move to provisioned to cut cost.

Consequence for modeling: item size and read consistency directly drive cost. Large items and strongly consistent reads consume more capacity.

---

## When to use DynamoDB

Strong fit:

- **Hyperscale applications.** DynamoDB exists because joins and strict consistency forced data onto a single machine. Dropping both lets data be sharded across machines with stable performance. If traffic may outgrow a single relational instance, DynamoDB removes the later migration.
- **Hyper-ephemeral compute (serverless, AWS Lambda).** Functions start on demand and run from unpredictable network locations. They have no time for connection pool setup and are awkward to place in private networks. DynamoDB's HTTP access and IAM auth need neither.
- **Most OLTP applications.** Many users reading and writing small pieces of data at high speed.
- **Caching.** Storing results of expensive queries or operations. Slower than an in-memory cache such as Redis, but fast, cheap, and low maintenance.
- **Simple data models.** Mostly key-value lookups, for example a session store.

Weaker fit, or cases that need care:

- **OLAP / analytics.** Large aggregate analyses over the dataset are the opposite of DynamoDB's targeted, key-based access.
- **Unknown or fast-changing access patterns.** A relational model gives more query flexibility and faster iteration when you cannot yet list your access patterns. An early-stage team may reasonably choose it and accept a possible migration later.
- **Queries that need specialized indexes.** Text search, geospatial queries, and searching inside arrays are not native. Do not assume a filter can stand in for them.
- **A requirement for cloud portability.** DynamoDB is AWS only.

Rules that hold regardless of fit:

- Know the access patterns before designing the table. This does not mean the model can never change: most changes are additive, and there are migration patterns for the rest.
- "Schemaless" only means the database will not enforce the schema. The application still needs one, and it becomes the application's job to validate it.
- DynamoDB handles relationships and complex filtering, but through key design rather than joins and ad hoc WHERE clauses.
- Scaling problems almost always come from misuse: relying on Scans, or putting all data under one partition key.

---

## Comparisons to other databases

| Alternative | Its advantages | DynamoDB's advantages | Decision guidance |
|---|---|---|---|
| **Relational (PostgreSQL, MySQL, Aurora, etc.)** | Familiar to most developers, strong tooling and framework support, flexible querying, easy iteration, lower risk of a fatal modeling mistake | Scales much further; works naturally with serverless compute | Usually a clear call. The hard cases are a temporal tradeoff (move fast now and maybe migrate later, versus model carefully now and never migrate) and a small team whose core app wants relational flexibility. |
| **MongoDB** | Document model with more query flexibility; extra index types (text, geospatial, multi-key); runs on any cloud | Rigid API makes it hard to write a query that degrades at scale (as long as you avoid full-table Scans); fully managed | MongoDB's flexible features tend to hurt at large scale, so the team needs discipline to avoid them if terabyte scale is expected. Do not self-host; use a managed offering. |
| **Apache Cassandra** | Same wide-column model (most DynamoDB modeling advice transfers); portable across clouds | No cluster operations: no node provisioning, re-sharding, or failure handling | Once you have accepted the wide-column model, the choice is lock-in versus operational cost. Prefer DynamoDB unless portability or regulation forces otherwise. |

---

## Core vocabulary

| Term | Meaning | Relational analog |
|---|---|---|
| **Table** | A grouping of items. Usually holds several entity types together, to avoid joins. Declares no columns or types beyond the key attributes. | Table (but one entity type per table) |
| **Item** | A single record. | Row |
| **Attribute** | A typed value on an item. Not required to be present on every item. | Column value |
| **Primary key** | Uniquely identifies each item. Declared at table creation and required on every item. | Primary key |
| **Secondary index** | A copy of the table's items reshaped under a different key schema, queryable on its own. | Index (loosely) |

### Attribute types

Every attribute has an explicit type, and the type determines which operations are legal on it.

| Category | Types | Typical use |
|---|---|---|
| **Scalar** | string, number, binary, boolean, null | Most attributes |
| **Complex (document)** | list, map | Nested or denormalized data, for example a map holding a payment plan, or a list of featured deals |
| **Set** | string set, number set, binary set (all elements one type, all unique) | Tracking uniqueness within one item, for example the reactions a user left on an issue, without extra round trips |

Type consequences: numbers can be incremented or decremented in place; sets support existence checks before a write and idempotent adds. The same value stored under two different types is not equal (the string `"1565954664"` does not match the number `1565954664`).

### Primary keys

| | Simple primary key | Composite primary key |
|---|---|---|
| Elements | Partition key only | Partition key + sort key |
| Other names | Hash key | Hash key + range key |
| Uniqueness | Partition key value is unique | The pair is unique; many items may share a partition key |
| Access | Fetch one item at a time | Fetch one item, or Query many items that share a partition key, optionally narrowed by sort key conditions |
| Use for | One-to-one lookups | Relationships and "fetch many" patterns |

Rules:

- A write without the full primary key is rejected.
- A write to a key that already exists **silently overwrites** the existing item unless you add a condition that forbids it (see `api-and-expressions.md`, `attribute_not_exists`).
- Primary key design is the most important modeling decision, because almost all data access goes through it.

### Secondary indexes

You declare a key schema for the index (partition key, optional sort key). DynamoDB copies items from the base table into the index in that shape and keeps them in sync. You then Query or Scan the index. Writes always go to the base table. An index can be given a custom projection that copies only some attributes, which keeps index items small.

| | Local secondary index (LSI) | Global secondary index (GSI) |
|---|---|---|
| Key schema | Same partition key as the base table, different sort key | Any attributes as partition key and sort key |
| Creation | Only when the table is created | Any time; can also be deleted later |
| Throughput | Shares the base table's throughput | Separate read and write throughput from the base table |
| Consistency | Eventual by default; strongly consistent reads available at higher read cost | Eventual only (replication from the base table is asynchronous) |
| Item collection size | Imposes a 10GB cap per partition key, counting base table items plus LSI items | No cap; large collections are split across partitions transparently |

Default to GSIs. They are more flexible, can be added and removed after the fact, and carry no item collection size limit. Choose an LSI only when you need strongly consistent reads on an alternate sort order under the same partition key, and you are confident no partition key will approach 10GB. Throughout the rest of this skill, "secondary index" means GSI unless stated otherwise.

---

## Item collections

An **item collection** is the set of items that share a partition key, in the base table or in a secondary index.

Example, with partition key `Actor` and sort key `Movie`:

| Actor (PK) | Movie (SK) | Role | Year | Genre |
|---|---|---|---|---|
| Tom Hanks | Cast Away | Chuck Noland | 2000 | Drama |
| Tom Hanks | Toy Story | Woody | 1995 | Children's |
| Tim Allen | Toy Story | Buzz Lightyear | 1995 | Children's |
| Natalie Portman | Black Swan | Nina Sayers | 2010 | Drama |

The two Tom Hanks items form one item collection. Natalie Portman's single item is also an item collection.

Why they matter:

1. **Partitioning.** All items with the same partition key live on the same storage partition. That is what makes reading several of them fast.
2. **Modeling.** The Query operation reads a contiguous range of one item collection in a single efficient request. Almost every modeling technique is about building item collections on purpose, in the base table or in an index, so that each access pattern maps to one Query.

Design habit: for each access pattern, ask "which item collection answers this, and in what sort order?" If none does, change the keys or add an index that creates one.

---

## DynamoDB Streams

A stream is an ordered, immutable log of item-level changes. Each time an item is created, updated, or deleted, a record describing the change is written to the table's stream. Multiple independent consumers, usually AWS Lambda functions, can process it.

Use for:

- Reacting to changes asynchronously, for example maintaining aggregates or derived items.
- Broadcasting changes to other services in an event-driven architecture.
- Using a table as a work queue.

Change data capture is built in, so there is no extra infrastructure to bolt on and operate.

---

## Time-to-live (TTL)

TTL lets DynamoDB delete items automatically, per item, instead of a scheduled cleanup job.

- Nominate one attribute on the table as the TTL attribute.
- On each item that should expire, store the expiry time in that attribute as a **Unix timestamp of type number** (epoch seconds, not from the book; a string or an ISO-8601 value will not work).
- DynamoDB periodically scans for items whose TTL value is in the past and deletes them.
- Items without the attribute never expire, so one table can mix expiring and permanent items (for example machine-generated tokens that expire after ten minutes next to user tokens that live until revoked).

**Gotcha: deletion is not prompt.** Items are usually removed within 48 hours after the expiry time, not at it. Expired items stay readable until then.

How to handle it:

- Never treat "the item still exists" as "the item is still valid".
- On a single-item read, compare the TTL attribute with the current time in application code and treat expired items as absent.
- On a Query or Scan, add a filter expression that drops items whose TTL value is at or before now.

```js
// Query that ignores items TTL has not yet physically deleted
{
  TableName: 'SessionStore',
  KeyConditionExpression: '#pk = :pk',
  FilterExpression: '#ttl > :now',
  ExpressionAttributeNames: { '#pk': 'PK', '#ttl': 'TTL' },
  ExpressionAttributeValues: {
    ':pk': { S: 'USER#alexdebrie' },
    ':now': { N: String(Math.floor(Date.now() / 1000)) }
  }
}
```

---

## Partitions

Partitions are the storage units behind a table, each roughly 10GB. A request router hashes the partition key of each request and forwards it to the node that owns that hash range. More data means more partitions, which is how the table grows without slowing down.

- Historically, table throughput was divided evenly across partitions, so skewed access could cause throttling while most of the capacity sat unused, and temporarily raising throughput (for a bulk import) could dilute per-partition throughput afterward.
- **Adaptive capacity** now moves throughput to the partitions that need it, so uneven distribution and throughput dilution are largely non-issues.
- You still need the concept for two reasons: it explains why item collections are fast (one collection, one partition), and two limits are defined per partition (throughput per partition, and item collection size with LSIs). See Limits below.

---

## Consistency

Consistency is about whether a read reflects every write that completed before it.

How a write flows:

1. The request router authenticates the request, hashes the partition key, and sends the write to the **primary node** for that partition.
2. The primary commits the write and also commits it to **one of two secondary nodes**, then acknowledges the client. The write now survives the loss of a single node.
3. The write is replicated **asynchronously** to the remaining secondary.

Reads may be served by any of the three nodes, so a read that lands on the lagging secondary can return slightly stale data.

| | Eventual consistency | Strong consistency |
|---|---|---|
| Guarantee | May miss very recent writes | Reflects all writes completed before the read |
| How to get it | Default | Pass `ConsistentRead=true` |
| Read cost | Half | Full (twice the eventual cost) |

The two places where consistency is a design decision:

1. **Reads on the base table.** Choose per request. Eventual is fine for most reads and costs half as much. Use strong reads where acting on stale data would be wrong (read-after-write flows, checks that gate a decision).
2. **Choice of secondary index type.**
   - **LSI:** same options as the base table, including `ConsistentRead=true`.
   - **GSI:** eventual only. Data is copied from the base table asynchronously, so a GSI read may not show a write you just made. The lag is small but must be accounted for. Requesting a consistent read on a GSI is not allowed.

Practical rule: if an access pattern needs strong consistency, serve it from the base table's primary key (or an LSI). Do not route read-your-own-write flows through a GSI.

---

## Limits that shape data models

| Limit | Value | Why it exists | Modeling consequence |
|---|---|---|---|
| **Item size** | 400KB per item | Large items mean larger disk reads, slower responses, fewer concurrent requests | Do not embed an unbounded list of related records in a parent item. Denormalizing into a list or map is fine only when the count is bounded. Split large items into smaller ones and read them selectively. |
| **Query / Scan read size** | 1MB of data read per request, applied **before** filter expressions | Caps the latency of any single request | Larger result sets must be paginated with follow-up requests. A filter does not make a broad read cheaper: you pay for and page through everything read. |
| **Partition throughput** | 3000 RCU or 1000 WCU per second on a single partition | Per-partition physical capacity | Applies per partition, not per table. A very hot partition key needs read or write sharding. Few workloads reach it, but check any "everything under one key" design. |
| **Item collection size (LSI only)** | 10GB per partition key, counting base table items plus LSI items | An LSI must be co-located with its base table partition | Once reached, **writes to that partition key are rejected**. Avoid LSIs on tables where a partition key can grow without bound. GSIs and tables without LSIs have no such cap. |

For comparison, MongoDB allows 16MB documents and Cassandra up to 2GB records, so the 400KB item limit regularly surprises people migrating from them. The limits are deliberate: they push designs toward small items and targeted reads.

---

## Overloading keys and indexes

A single table usually holds several entity types, because co-locating related entities is what makes one-request reads possible. To support that, key attributes get generic names and their values follow a per-entity pattern. This is **key overloading**.

- Name the key attributes generically: `PK` and `SK` on the table, and likewise for index keys (commonly `GSI1PK`, `GSI1SK`). A name like `OrgName` would be wrong for the User items in the same table.
- Prefix the values with the entity type: `ORG#<OrgName>`, `USER#<UserName>`.

Why prefix:

1. The item type is recognizable from the key alone.
2. It prevents collisions between entity types. Primary keys must be unique across the whole table, so without prefixes an organization named "Keller Williams" and a user named "Keller Williams" would overwrite each other.

Example: a SaaS table with Organizations and their Users.

| Entity | PK | SK |
|---|---|---|
| Organization | `ORG#<OrgName>` | `ORG#<OrgName>` |
| User | `ORG#<OrgName>` | `USER#<UserName>` |

| PK | SK | Other attributes |
|---|---|---|
| `ORG#BERKSHIRE` | `ORG#BERKSHIRE` | OrgName, SubscriptionLevel |
| `ORG#BERKSHIRE` | `USER#CHARLIEMUNGER` | UserName, Role |
| `ORG#BERKSHIRE` | `USER#WARRENBUFFETT` | UserName, Role |
| `ORG#FACEBOOK` | `ORG#FACEBOOK` | OrgName, SubscriptionLevel |
| `ORG#FACEBOOK` | `USER#SHERYLSANDBERG` | UserName, Role |

Each organization and its users share a partition key, so they form one item collection: a Query on `PK = ORG#BERKSHIRE` returns the organization and all of its users in one request. The same technique applies to secondary indexes, where one index is overloaded to serve different access patterns for different entity types.

(The non-key attribute names and exact casing in the sample rows are illustrative; the book's figure did not survive extraction. The key patterns are the book's.)

---

## Quick checklist

- Access patterns are written down before the key schema is chosen.
- Every access pattern maps to a single-item lookup or a Query on one item collection. No pattern depends on a Scan or on a filter doing the real work.
- Key attributes are generic (`PK`, `SK`) and values carry entity prefixes.
- No item can grow past 400KB; unbounded relationships are separate items, not embedded lists.
- No single partition key is expected to exceed 3000 reads or 1000 writes per second, or it is sharded.
- Indexes are GSIs unless a strongly consistent alternate sort order is required. If an LSI exists, item collection size is monitored against the 10GB cap.
- Reads that must reflect the latest write use `ConsistentRead=true` on the base table, never a GSI.
- Code that reads TTL-managed items checks expiry itself.
