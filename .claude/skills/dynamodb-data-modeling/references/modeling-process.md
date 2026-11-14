# DynamoDB Modeling Process: From Requirements to Table Design to Code

How to go from an application description to a DynamoDB table design and then to an implementation: the mindset shifts from relational modeling, the ordered modeling steps with the documents to produce at each step, the case for (and against) single-table design, and the rules for turning the model into code. Read this before designing any new table or reviewing an existing design.

## Contents

- [What changes compared to relational modeling](#what-changes-compared-to-relational-modeling)
- [The modeling process](#the-modeling-process)
  - [Step 1: Entity-relationship diagram](#step-1-entity-relationship-diagram)
  - [Step 2: List every access pattern](#step-2-list-every-access-pattern)
  - [Step 3: Model the primary key structure](#step-3-model-the-primary-key-structure)
  - [Step 4: Secondary indexes and streams](#step-4-secondary-indexes-and-streams)
- [Document templates](#document-templates)
- [Single-table design](#single-table-design)
- [From model to implementation](#from-model-to-implementation)
- [Review checklist](#review-checklist)

---

## What changes compared to relational modeling

Modeling a DynamoDB table the way you would model a relational schema gives you the worst of both: none of DynamoDB's scaling benefits and none of the relational database's flexibility. Four differences drive everything else.

| Topic | Relational | DynamoDB | Consequence for the design |
|---|---|---|---|
| **Joins** | Reassemble data at read time with `JOIN` | No joins at all | Preassemble data at write time in the exact shape a read needs |
| **Normalization** | Normalize to 3NF, one copy of each fact | Denormalize deliberately | Data integrity for duplicated data becomes an application concern |
| **Entities per table** | One table per entity type | Many entity types in one table | Generic key names (`PK`, `SK`), items with different attribute sets |
| **Filtering** | Arbitrary `WHERE` on any column | Filtering is built into the primary key and secondary indexes | Every read must be planned up front as a key-based lookup |

### Joins

Joins are CPU-heavy and work best when all data sits on one machine, which forces vertical scaling. DynamoDB is built for horizontal scale, so it removes joins entirely.

- Do not rebuild the join in application code: fetching a record and then issuing follow-up requests for its related records is the pattern to avoid. Each extra request is a network round trip, and serial ("waterfall") requests get slower as the application grows.
- Instead, arrange items so that one request returns everything a read needs (see item collections under single-table design).

### Normalization

Quick reference for what you are deliberately violating:

| Form | Rule | Plain meaning |
|---|---|---|
| 1NF | Each column value is atomic | No multi-valued attributes |
| 2NF | No partial dependencies | Every non-key attribute depends on the whole key |
| 3NF | No transitive dependencies | Non-key attributes depend only on the key, not on each other |

Normalization existed for two reasons. Evaluate each for DynamoDB:

1. **Save storage.** No longer relevant. Storage is cheap; compute is the scarce resource. Optimize for compute by storing data in the shape reads need.
2. **Protect data integrity.** Still relevant. One copy of a fact means one place to update. When you duplicate, you own the consistency problem.

Decision rule for any denormalization: ask where and when the data gets updated, and how you will find every item that carries a copy. In most applications this is manageable, but it can add real complexity, so answer the question explicitly rather than assuming.

### Multiple entity types per table

To fetch a Customer and that customer's Orders in one request, both must live in the same table with primary keys designed so they land together. Implications:

- Primary key attributes hold different things for different entity types, so they cannot have descriptive names. Use `PK` and `SK` rather than `CustomerId`.
- Items in the same table have different attributes. This is fine for application code (the data access layer hides it) but makes console browsing and analytics exports harder.

### Filtering

A `WHERE` clause reads and discards records, which is wasted compute at scale. In DynamoDB the primary key and the secondary index keys are the filter. You get the same single-digit-millisecond response at 1 GB as at 1 TB and beyond, in exchange for planning every read up front.

---

## The modeling process

The design is driven entirely by access patterns. A generic model that "allows flexible access later" does not exist in DynamoDB. Follow the steps in order and do not skip any; expect a few iterations even with experience.

1. Understand the application.
2. Create an entity-relationship diagram (ERD).
3. Write out all access patterns.
4. Model the primary key structure.
5. Satisfy remaining access patterns with secondary indexes and streams.

Roughly 90% of the work happens in this planning stage, before any code is written.

### Step 1: Entity-relationship diagram

List the entities (the nouns: Users, Notes, Orders, Organizations), their attributes, and the relationships between them with cardinality (one-to-one, one-to-many, many-to-many).

- Build one even for a small model. It forces thinking about the data up front and is a useful artifact for people new to the application.
- Size is not a reason to give up on one table: a model with eight entities and fourteen relationships (the GitHub example) fits in a single table.

Minimal example for a notes application:

```
User (username, email, createdAt)  1 ---- owns ---- N  Note (title, createdAt, body)
```

### Step 2: List every access pattern

In a relational database the ERD goes almost straight into the schema. Here it does not: the next step is to enumerate every read and write the application performs. Be specific and thorough. The most common failure with DynamoDB is discovering an unplanned access pattern after the model has solidified.

Talk to product, engineering, and business stakeholders until the list is complete. Two ways to derive it:

| Approach | Use when | How |
|---|---|---|
| **API-centric** | Building a REST API | List each endpoint and the response shape it must return |
| **UI-centric** | Server-side rendering or a backend-for-frontend API | Walk each screen and its URL, and write down every piece of data needed to render it |

Record the patterns in an access pattern chart (template below). Fill in the left side (entity, access pattern, special requirements in Notes) during this step. Fill in the right side (index, parameters, API call details) as the design takes shape in steps 3 and 4.

Capture details that change the design: sort order, "most recent N", filters, uniqueness requirements, time-based expiry, whether a write must be conditional.

### Step 3: Model the primary key structure

The primary key is the foundation of the table. Work through these sub-steps.

**3a. Start an entity chart.** Copy every entity from the ERD into a chart with columns for entity, PK, and SK (template below). The rows will change as the design evolves:

- **Rows may disappear.** An ERD entity that is stored inside its parent as a list or map attribute is not a separate item (see the complex attribute strategy in `relationship-strategies.md`).
- **Rows may appear.** A many-to-many relationship often needs its own item type to represent the relationship. An item type may also be added purely to enforce uniqueness on an attribute.

**3b. Choose simple or composite primary key.** Most non-trivial models need a composite key. Rule of thumb: if any access pattern retrieves multiple entities ("get all Orders for a User") or multiple entity types ("get a Sensor and its most recent SensorReadings"), use a composite primary key.

**3c. Design the key format for each entity.** Priority order:

1. Satisfy uniqueness first. The key must uniquely identify each item of that type.
2. With whatever flexibility remains, solve "fetch many" access patterns by placing related items in the same item collection.

Principles for key formats:

- **Use only what the client knows at read time.** The caller must be able to construct the full primary key, or it needs an extra query to discover it. If the URL is `/users/alexdebrie`, the username is safe to put in the key.
- **Anti-pattern: a `CreatedAt` timestamp in the primary key just to make it unique.** It does guarantee uniqueness, but the timestamp is usually not available when the item must be read or updated later. Use something the client will have, or define explicitly how the client obtains it.
- **Prefix key values with the entity type.** `CUSTOMER#<CustomerId>`, `ORDER#<OrderId>`. Prefixes make items identifiable in the console and in exports, and they prevent accidental collisions between entity types that share identifier values.

Example entity chart for two top-level entities:

| Entity | PK | SK |
|---|---|---|
| Customer | `CUSTOMER#<CustomerId>` | `METADATA#<CustomerId>` |
| CustomerOrder | `ORDER#<OrderId>` | `METADATA#<OrderId>` |

**3d. Iterate.** Start anywhere and model. With experience, start with the parts of the ERD that look hardest (dense relationships, many access patterns on one entity); once those are settled the rest tends to fall into place.

### Step 4: Secondary indexes and streams

Solve as much as possible with the base table's primary key first. Patterns served by the primary key cost no extra write throughput and avoid the eventual consistency of global secondary indexes.

For what remains:

- **Do not create one index per read pattern.** That is overkill and costs more.
- **Overload secondary indexes** the same way the primary key is overloaded: generic attribute names `GSI1PK` / `GSI1SK`, with different entity types writing different values, so one index serves several access patterns.
- Add the index key templates to the entity chart (extra columns `GSI1PK`, `GSI1SK`, and so on) and record which index each access pattern uses in the access pattern chart.
- Streams cover patterns that are not direct reads, such as reacting to changes or maintaining derived data. Note the stream-driven patterns in the chart as well.

---

## Document templates

Produce both documents for every design and keep them with the code. They are the design's source of truth during development and the onboarding artifact afterwards.

### Entity chart

One row per item type that is actually stored in the table (not per ERD entity). Add a pair of columns for each secondary index. Leave index cells empty for item types that do not appear in that index.

```markdown
| Entity       | PK                  | SK                  | GSI1PK                         | GSI1SK              | Notes |
|--------------|---------------------|---------------------|--------------------------------|---------------------|-------|
| Organization | ORG#<OrgName>       | METADATA#<OrgName>  |                                |                     |       |
| User         | ORG#<OrgName>       | USER#<UserName>     | ORG#<OrgName>#USER#<UserName>  | USER#<UserName>     |       |
| Ticket       | TICKET#<TicketId>   | TICKET#<TicketId>   | ORG#<OrgName>#USER#<UserName>  | TICKET#<TicketId>   | TicketId = timestamp + random suffix, sortable |
```

Also record, outside the table or in Notes: ERD entities that were folded into a parent as a complex attribute, item types that exist only to represent a relationship, and item types that exist only to enforce uniqueness.

### Access pattern chart

One row per access pattern, grouped by entity. The book's columns are Entity, Access Pattern, Index, Parameters, Notes. The left two columns come from requirements; the rest describe the DynamoDB call that satisfies the pattern.

```markdown
| Entity  | Access pattern              | Index      | Parameters   | Notes |
|---------|-----------------------------|------------|--------------|-------|
| Session | Create Session              | Main table | SessionToken | <operation, condition, special requirements> |
|         | Get Session                 | Main table | SessionToken |       |
|         | Delete Session (time-based) |            |              |       |
|         | Delete Session (manual)     |            |              |       |
```

The book presents this chart with only the first two columns filled (the session store requirements) and fills the rest in during design; the Index and Parameters values shown above are placeholders to illustrate what goes there. Guidance for filling it:

- **Index:** main table or the name of the secondary index (`GSI1`).
- **Parameters:** the values the caller supplies to build the key (username, order ID).
- **Notes:** the API operation (GetItem, Query, PutItem, TransactWriteItems), key condition (`PK = ORG#<OrgName> AND begins_with(SK, "USER#")`), `ScanIndexForward`, limits, condition expressions, and any unusual requirement.
- A design is not finished while any row has an empty right-hand side, and no row should resolve to a Scan or to serial follow-up requests without an explicit justification.

---

## Single-table design

### What it is

Use as few tables as possible, ideally one table per application or microservice. The goal is to tune the table so each access pattern is handled with as few requests as possible, ideally one.

The mechanism is the **item collection**: all items in a table or index that share a partition key. A Query reads multiple items from one item collection in one request, and those items can be of different types. Placing a parent item and its related items under the same partition key "pre-joins" them at write time.

| PK | SK | Type | Attributes |
|---|---|---|---|
| `USER#alexdebrie` | `USER#alexdebrie` | User | name, email, ... |
| `USER#alexdebrie` | `ORDER#<OrderId>` | Order | status, amount, ... |
| `USER#alexdebrie` | `ORDER#<OrderId>` | Order | status, amount, ... |

`Query(PK = "USER#alexdebrie")` returns the user and the user's orders together. (Key formats here are illustrative; see the e-commerce example reference for the real design.)

### Why

| Benefit | Weight |
|---|---|
| **One request returns heterogeneous items**, replacing a join without serial network calls | The main reason |
| Fewer tables to configure, alarm on, and monitor | Marginal |
| With provisioned capacity, rarely used entity types share the capacity headroom of busy ones | Marginal, and no saving at all with on-demand billing |

### Downsides

| Downside | Assessment |
|---|---|
| **Steep learning curve.** An overloaded table looks nothing like normalized tables. | Real, but not a valid reason to use DynamoDB badly. |
| **Inflexible to new access patterns.** The table is tailored to the patterns it was designed for. New entities or new ways of reading may require an ETL pass that scans the table and adds attributes to existing items. | The most legitimate complaint. Migrations add friction but are routine (see the migration strategies reference). |
| **Analytics are harder.** DynamoDB is an OLTP store and is intentionally poor at OLAP. Data must be exported to another system, and a denormalized, overloaded table must be unwound and re-normalized first. | Plan the data pipeline earlier in the project than you otherwise would. |

### When not to use it

General rule: skip single-table design when query flexibility or easier analytics matters more than the fastest possible reads. These are exceptions, not the default, and even when opting out you should understand single-table design well enough to say why it does not fit.

| Situation | Why single-table loses its value | What to do instead |
|---|---|---|
| **New application where developer agility outweighs performance** (typical: greenfield, serverless, early-stage, access patterns still unknown) | DynamoDB was built for workloads that outgrew relational databases, where access patterns are already well known. Without known patterns, the tailored design costs flexibility for performance you do not yet need. | "Faux-SQL": one table per entity, normalized, with multiple serial requests per access pattern. Acceptable if roughly 100 ms responses are fine where a single-table design would give sub-30 ms. |
| **GraphQL APIs** | Each type is resolved by an independent resolver. The root resolver fetches the User, then the Order resolver makes its own request. The backend issues multiple serial requests regardless of how the table is laid out, so you pay all the costs of single-table design and get little of the benefit. | One table per entity is fine; it is more flexible and easier for analytics. DynamoDB itself remains a good fit. |

Even in a multi-table design, the rest of this skill still applies: design for access patterns, denormalize where it helps, and use composite keys and item collections within each table.

---

## From model to implementation

Six rules for the data access code.

### 1. Separate indexing attributes from application attributes

An item carries two kinds of attributes:

```json
{
  "PK": "USER#alexdebrie",
  "SK": "USER#alexdebrie",
  "GSI1PK": "ORG#facebook",
  "GSI1SK": "USER#alexdebrie",
  "Type": "User",
  "Username": "alexdebrie",
  "FirstName": "Alex",
  "LastName": "DeBrie",
  "OrganizationName": "Facebook"
}
```

- **Indexing attributes** (`PK`, `SK`, `GSI1PK`, `GSI1SK`): exist only to place the item in the right item collections and order. No business meaning.
- **Application attributes** (`Username`, `FirstName`, ...): what the business logic uses.

Application attributes feed the indexing attributes (the username fills in the `PK`, `SK`, and `GSI1SK` templates). Never go the other way: do not drop `Username` because it is "already in the PK", and do not parse keys to recover business values. Doing so adds complexity and risks data loss when the key design changes in a migration. The cost is slightly larger items; it is worth it.

### 2. Implement the data model at the boundary of the application

Raw DynamoDB items carry indexing attributes and type descriptors (`{"S": "..."}`), which are noise for business logic. Confine all of it to one data access module:

- Core code calls functions such as `getUser(username)` and receives plain application objects.
- The data module builds keys from parameters, performs the call, and converts items to and from application objects.
- Nothing outside that module knows key templates, attribute names in the table, or index names.

Adapted from the book's example (Node.js, DocumentClient-style):

```js
// data/users.js - the only place that knows the key templates
const userKey = (username) => ({ PK: `USER#${username}`, SK: `USER#${username}` })

const getUser = async (username) => {
  const { Item } = await client.get({ TableName, Key: userKey(username) }).promise()
  return Item && { username: Item.Username, firstName: Item.FirstName, lastName: Item.LastName }
}

const saveUser = async (user) => {
  await client.put({
    TableName,
    Item: {
      ...userKey(user.username),
      GSI1PK: `ORG#${user.orgName}`,
      GSI1SK: `USER#${user.username}`,
      Type: 'User',
      Username: user.username,
      FirstName: user.firstName,
      LastName: user.lastName,
      OrganizationName: user.orgName
    }
  }).promise()
  return user
}
```

### 3. Do not reuse attributes across indexes

When `SK` and `GSI1SK` hold the same value for some entity, it is tempting to define GSI1 with a key schema of `GSI1PK` + `SK` and skip the duplicate attribute. Do not.

- With several entity types in the table, one attribute serving two indexes forces every entity's keys to work in both at once, which quickly becomes unworkable.
- It makes adding access patterns and migrating data harder, because changing one index's key changes the other's.

Rule: name each global secondary index `GSI<N>` and give it its own dedicated attributes `GSI<N>PK` and `GSI<N>SK`. Accept the small storage cost.

### 4. Put a `Type` attribute on every item

Write a plain string naming the entity type (`User`, `Order`, `SensorReading`) on every item, in the data access layer. It pays off in three places:

- **Orientation** when browsing the table.
- **Migrations:** a background job that scans the table to add new indexing attributes can use a filter expression on `Type` to select only the entity types it needs.
- **Analytics:** after exporting to another system (for example Redshift, or S3 queried with Athena), the transform that splits the single table back into per-entity tables keys off `Type`.

### 5. Write debugging scripts for access patterns

Debugging through the console is hard: entity types are mixed together, lookups use indexing attributes rather than application values, and attribute names may be abbreviated. Instead, write a small CLI script per access pattern that takes the pattern's parameters, calls the data access function, and prints the result.

```js
// scripts/getUser.js  ->  node scripts/getUser.js alexdebrie
const { getUser } = require('../data/users')
getUser(process.argv[2]).then((user) => console.log(user))
```

These matter most for multi-item reads through a secondary index with sort key conditions. Write them at the same time as the data access code, not when something breaks.

### 6. Shorten attribute names (advanced, large tables only)

Attribute names are stored on every item, so at very large scale abbreviating application attribute names (`Username` -> `u`, `FirstName` -> `fn`) reduces storage cost.

- Safe only because of rule 2: the application never sees the stored names, and the data layer maps them back when rehydrating objects.
- Not worth the loss of readability for typical tables. Consider it when item counts reach the billions.
- This is the acceptable way to save storage; reusing indexing attributes across indexes (rule 3) is not.

---

## Review checklist

- An ERD exists and every relationship has a cardinality.
- Every access pattern is listed, with index, parameters, and operation filled in; none relies on Scan or on application-side joins without a stated reason.
- The entity chart lists every stored item type with PK/SK templates and each index's key templates.
- Composite primary key is used wherever a pattern fetches multiple items or item types.
- Every key can be built from values the client has at read time; no incidental `CreatedAt` in a primary key.
- Key values are prefixed by entity type.
- As many patterns as possible are served by the base table; indexes are overloaded with `GSI<N>PK` / `GSI<N>SK`, not one index per pattern, and no attribute is shared between indexes.
- For every duplicated piece of data, it is known when it changes and how all copies are found.
- Single-table design was chosen deliberately, or the reason for opting out (agility-first new app, GraphQL) is written down.
- All DynamoDB access lives in one boundary module; every item has `Type`; application attributes are stored separately from indexing attributes; debug scripts exist for non-trivial patterns.
