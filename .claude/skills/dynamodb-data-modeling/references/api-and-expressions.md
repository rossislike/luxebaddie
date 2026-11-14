# DynamoDB API Actions and Expressions

How to turn a designed access pattern into a correct DynamoDB request: which API action to use, what each one requires, the optional request properties, and the five expression types with their rules and pitfalls. Read this when writing or reviewing code that calls DynamoDB.

Examples show request parameters in the low-level format with explicit attribute types (`{ S: '...' }`, `{ N: '1' }`). With the Node.js Document Client or the Boto3 Table resource, the same parameters apply but values are plain language types.

## Contents

- [The three API action types](#the-three-api-action-types)
- [How DynamoDB enforces efficiency](#how-dynamodb-enforces-efficiency)
- [Expression attribute names and values](#expression-attribute-names-and-values)
- [ORMs and client libraries](#orms-and-client-libraries)
- [Optional request properties](#optional-request-properties)
- [Expressions overview](#expressions-overview)
- [Key condition expressions](#key-condition-expressions)
- [Filter expressions](#filter-expressions)
- [Projection expressions](#projection-expressions)
- [Condition expressions](#condition-expressions)
- [Update expressions](#update-expressions)
- [Pitfall summary](#pitfall-summary)

---

## The three API action types

Pick the action by what you are operating on.

| Operating on | Action type | Actions | Key requirement | Where it runs |
|---|---|---|---|---|
| Specific items | **Item-based** | `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, plus batch (`BatchGetItem`, `BatchWriteItem`) and transactional (`TransactGetItems`, `TransactWriteItems`) variants | Full primary key of every item (partition key, and sort key if the table has one) | Base table only |
| One item collection | **Query** | `Query` | Partition key (exact match); optional sort key condition | Base table or secondary index |
| The whole table | **Scan** | `Scan` | None | Base table or secondary index |

### Item-based actions

- `GetItem`: read one item.
- `PutItem`: write an item. **Replaces** any existing item with the same key in full.
- `UpdateItem`: change specific attributes. Creates the item if it does not exist; attributes you do not mention are left as they are.
- `DeleteItem`: remove one item.

Three rules:

1. The full primary key must be given.
2. **Every write, update, and delete is item-based.** There is no "update attribute X on all items with partition key Y". To change many items, you address each by its full key.
3. Item-based actions target the base table, never a secondary index.

Batch versus transaction (both still require the exact key of each item):

| | Batch actions | Transactional actions |
|---|---|---|
| Failure behavior | Each read or write succeeds or fails independently | All succeed or all fail; one failure rolls back the rest |
| Purpose | Fewer network round trips | Atomicity across items, including assertions on items you do not modify |

### Query

Reads multiple items that share a partition key, from the base table or an index. This is the workhorse for relationships (one-to-many, many-to-many) and for any "fetch many" pattern.

```js
// All of an actor's roles (base table: PK = Actor, SK = Movie)
{
  TableName: 'MoviesAndActors',
  KeyConditionExpression: '#actor = :actor',
  ExpressionAttributeNames: { '#actor': 'Actor' },
  ExpressionAttributeValues: { ':actor': { S: 'Tom Hanks' } }
}
```

```js
// All actors in a movie, via a GSI that flips the keys (PK = Movie, SK = Actor)
{
  TableName: 'MoviesAndActors',
  IndexName: 'MoviesIndex',
  KeyConditionExpression: '#movie = :movie',
  ExpressionAttributeNames: { '#movie': 'Movie' },
  ExpressionAttributeValues: { ':movie': { S: 'Toy Story' } }
}
```

The partition key is mandatory on every Query. If a pattern needs to look up by a different attribute, that is the signal to add a secondary index whose partition key is that attribute, not to reach for a Scan or a filter.

### Scan

Reads every item in the table or index, paginating as it goes. Avoid it on any latency-sensitive path such as a web request. Acceptable uses:

- The table is very small.
- You are exporting the whole table to another system.
- You deliberately built a sparse secondary index that is meant to be scanned (the index holds only the few items you want).

Default position: do not use Scan.

---

## How DynamoDB enforces efficiency

The API is narrow on purpose: it will not let you express a request whose cost grows with total table size.

| Step | Data structure | Cost |
|---|---|---|
| 1. Find the node for the partition key | Hash table | O(1) |
| 2. Find the starting sort key value | B-tree | O(log n), where n is the size of the item collection, not the table |
| 3. Read until the sort key condition stops matching | Sequential read | Capped at 1MB |

What follows from this:

- Item-based actions and Query require the partition key, so locating the data is constant time at any table size.
- Item-based actions also require the sort key, making the whole operation constant time.
- Query can only return a **contiguous range** of an item collection. Sort key conditions that describe a range (`=`, `<`, `<=`, `>`, `>=`, `BETWEEN`, `begins_with`) are allowed. Conditions that would require examining every entry (`contains`, "ends with") are not available on keys.
- Query and Scan read at most **1MB** per request. To get more you must loop explicitly, passing the previous response's `LastEvaluatedKey` as the next request's `ExclusiveStartKey`. A pagination loop in your code is a visible warning that the access pattern reads an unbounded amount of data.

```js
// Pagination loop (Document Client style)
let ExclusiveStartKey
const items = []
do {
  const resp = await client.query({ ...params, ExclusiveStartKey }).promise()
  items.push(...resp.Items)
  ExclusiveStartKey = resp.LastEvaluatedKey
} while (ExclusiveStartKey)
```

---

## Expression attribute names and values

Expressions use two kinds of placeholders, resolved server-side from two request maps.

| Placeholder | Map | Required? | Purpose |
|---|---|---|---|
| `:name` | `ExpressionAttributeValues` | Always. Literal values cannot be written inline in an expression. | Carries the value together with its type |
| `#name` | `ExpressionAttributeNames` | Only in specific cases, but recommended everywhere | Stands in for an attribute name |

Why values are separate: every DynamoDB value is typed and the type is never inferred. Keeping typed values out of the expression string keeps expressions simple to parse and lets the SDK validate value shapes before sending. Remember that type is part of equality: `{ S: '1565954664' }` does not equal `{ N: '1565954664' }`.

When `#` name placeholders are mandatory:

- The attribute name is a **reserved word**. There are 573 of them, including common names such as `Bucket`, `By`, `Count`, `Month`, `Name`, `Timestamp`, `Timezone`, and `Year`.
- The attribute name contains a **period**. A `.` in an expression means "nested attribute access", so a literal dotted name must go through a placeholder.
- You address nested attributes of a map and want unambiguous paths (`#phone.#mobile`).

Recommendation: use `#` placeholders for every attribute name instead of checking the reserved word list each time.

---

## ORMs and client libraries

Do not use an ORM / ODM-style abstraction over DynamoDB.

- **It steers you to the wrong model.** ORMs assume one table per object type and relations via foreign keys. In DynamoDB, many entity types share one table, one item may represent more than one object, and fetching related data depends entirely on how the primary key was designed.
- **It saves little.** The API is already one method per action. An ODM mostly re-exposes the same parameters without the readability win that ORMs give over long SQL strings.

Acceptable helpers:

- **Thin type-marshalling wrappers**: the Document Client in the AWS SDK for Node.js, the Table resource in Boto3. You still make the same API calls with the same parameters; they only convert native language values to typed attribute values.
- **Entity-mapping helpers that are explicitly not ORMs**, such as DynamoDB Toolbox for Node.js. They cut boilerplate for mapping application objects to table items, but you still design the model and issue the API calls yourself.

```js
// Low-level client: explicit types
{ TableName: 'MoviesAndActors',
  Item: { Actor: { S: 'Tom Hanks' }, Movie: { S: 'Forrest Gump' }, Year: { S: '1994' } } }

// Document Client: types inferred
{ TableName: 'MoviesAndActors',
  Item: { Actor: 'Tom Hanks', Movie: 'Forrest Gump', Year: '1994' } }
```

Workflow advice: do the modeling first (entities, access patterns, key design in a spreadsheet or NoSQL Workbench), and only then translate each access pattern into an API call. Application code should touch the DynamoDB API in as few places as possible.

---

## Optional request properties

| Property | Available on | Effect |
|---|---|---|
| `ConsistentRead` | `GetItem`, `BatchGetItem`, `Query`, `Scan` | Strongly consistent read instead of the eventual default |
| `ScanIndexForward` | `Query` only | Sort key read direction |
| `ReturnValues` | `PutItem`, `UpdateItem`, `DeleteItem` (in `TransactWriteItems` the related property is `ReturnValuesOnConditionCheckFailure`) | Return the item as it was before or after the write |
| `ReturnConsumedCapacity` | Reads and writes | Report capacity units used |
| `ReturnItemCollectionMetrics` | Write actions | Report the size of the affected item collection |

### ConsistentRead

- Default reads are eventually consistent: they probably, but not certainly, reflect all earlier writes.
- `ConsistentRead: true` guarantees the read reflects all prior writes, at twice the read cost. A 4KB item costs half a read unit eventually consistent and a full read unit strongly consistent.
- Allowed on the base table and on **local** secondary indexes. **Not allowed on global secondary indexes**, which are always eventually consistent.

### ScanIndexForward

Items in a collection are read in ascending sort key order by default. `ScanIndexForward: false` reads in descending order.

- "Most recent N" pattern: timestamp sort key, descending read, plus `Limit`. Without it you would page through the whole collection to reach the newest items.
- Also used for reverse alphabetical reads and for "pre-joined" one-to-many reads where the parent item sorts after its children.

```js
// 20 most recent readings for a sensor (PK = SensorId, SK = Timestamp)
{
  TableName: 'SensorReadings',
  KeyConditionExpression: '#s = :s',
  ExpressionAttributeNames: { '#s': 'SensorId' },
  ExpressionAttributeValues: { ':s': { S: 'sensor-1' } },
  ScanIndexForward: false,
  Limit: 20
}
```

### ReturnValues

Writes often happen without knowing the item's current state (a conditional put, an increment, a delete). `ReturnValues` gets that state back in the same request instead of a separate read.

| Value | Returns |
|---|---|
| `NONE` (default) | Nothing |
| `ALL_OLD` | The whole item as it was before the operation |
| `UPDATED_OLD` | Only the attributes the operation touched, with their old values |
| `ALL_NEW` | The whole item as it is after the operation |
| `UPDATED_NEW` | Only the attributes the operation touched, with their new values |

Typical uses: read a counter's new value after incrementing it (`UPDATED_NEW`, the basis of auto-incrementing IDs), or see what a delete removed (`ALL_OLD`). Not from the book: `PutItem` and `DeleteItem` accept only `NONE` and `ALL_OLD`; the `UPDATED_*` and `ALL_NEW` options are for `UpdateItem`.

### ReturnConsumedCapacity

- `TOTAL`: overall capacity consumed by the request.
- `INDEXES`: the total plus a breakdown for the base table and each secondary index involved.

Consumed capacity depends on item size, on read consistency, and on whether the request is transactional. Useful when:

- Prototyping a design: run sample traffic and see which access patterns are expensive, then extrapolate to 10x or 100x.
- Billing customers based on their actual read and write usage.

### ReturnItemCollectionMetrics

Only meaningful when the table has a **local secondary index**. With an LSI, an item collection (base table items plus LSI items for one partition key) cannot exceed 10GB, and writes that would exceed it are rejected.

- Set `ReturnItemCollectionMetrics: 'SIZE'` on writes and inspect `ItemCollectionMetrics.SizeEstimateRangeGB` in the response.
- Raise an internal alert when a collection passes a threshold such as 7 to 8GB, so you learn about it before writes start failing.
- Without an LSI there is no item collection size limit and the property has little use.

---

## Expressions overview

| Expression | Used in | Operates on | Purpose |
|---|---|---|---|
| **Key condition** | `Query` | Primary key attributes only | Select which items to read |
| **Filter** | `Query`, `Scan` | Any attribute | Drop already-read items before returning them |
| **Projection** | All reads | Any attribute, including nested | Choose which attributes come back |
| **Condition** | All writes | Any attribute | Assert state before a write; cancel the write if false |
| **Update** | `UpdateItem` | Any non-key attribute | Describe the changes to make |

All five can use `#` name placeholders. All except projection expressions use `:` value placeholders.

---

## Key condition expressions

Rules:

- Required on every Query. May reference only the key attributes of the table or index being queried.
- The partition key condition is an exact match (`#pk = :pk`).
- The sort key condition is optional and uses `=`, `<`, `<=`, `>`, `>=`, `BETWEEN ... AND ...`, or `begins_with()`.
- Sort order: number sort keys sort numerically. String sort keys sort by UTF-8 bytes, which is roughly alphabetical but places **all uppercase letters before lowercase**. Normalize case in keys you intend to sort or range over.

```js
// A customer's orders in a date range (PK = CustomerId, SK = OrderTime as ISO-8601)
{
  TableName: 'CustomerOrders',
  KeyConditionExpression: '#c = :c AND #ot BETWEEN :start AND :end',
  ExpressionAttributeNames: { '#c': 'CustomerId', '#ot': 'OrderTime' },
  ExpressionAttributeValues: {
    ':c': { S: '36ab55a589e4' },
    ':start': { S: '2020-01-10T00:00:00.000000' },
    ':end': { S: '2020-01-20T00:00:00.000000' }
  }
}
```

Idioms:

- ISO-8601 timestamp strings sort chronologically, so time ranges are plain sort key ranges.
- Any sort key condition can be rewritten as a `BETWEEN`, so standardizing on `BETWEEN` keeps query-building code uniform.
- Key conditions are how heterogeneous items are fetched together: design an item collection that holds a parent and its related items, then select the range that covers them. This gives join-like reads in one request without a join.

---

## Filter expressions

A filter expression removes items from the result of a Query or Scan. Unlike a key condition, it can reference any attribute.

```js
// Tom Hanks' roles in dramas
{
  TableName: 'MovieRoles',
  KeyConditionExpression: '#actor = :actor',
  FilterExpression: '#genre = :genre',
  ExpressionAttributeNames: { '#actor': 'Actor', '#genre': 'Genre' },
  ExpressionAttributeValues: {
    ':actor': { S: 'Tom Hanks' },
    ':genre': { S: 'Drama' }
  }
}
```

**The central pitfall: filters run after the read.** DynamoDB processes a Query or Scan in this order:

1. Read items matching the key condition (or all items, for a Scan), **up to 1MB**.
2. Apply the filter expression to what was read.
3. Return what remains.

Consequences:

- A filter does not reduce the data read, the capacity consumed, or the number of pages. It only reduces what crosses the wire.
- Example: a 1GB table in which the matching items total 100KB. A Scan with a filter still needs about 1000 requests to cover the table, and many of those responses are empty.
- A response with zero items but a `LastEvaluatedKey` is not the end of the results. Keep paginating until `LastEvaluatedKey` is absent.
- Scan plus filter is not an access pattern. It is not viable for OLTP use at any real table size.

Rule: a filter is never a substitute for key design. If you need to find items by an attribute, build that attribute into a primary key or a secondary index key.

Legitimate uses:

1. **Smaller payloads.** Trim items you would discard anyway, saving bandwidth and response time.
2. **Simpler application code.** Let the server do filtering you would otherwise do right after the call.
3. **TTL correctness.** TTL deletion can lag expiry by up to about 48 hours, so filter out items whose expiry time has passed (`#ttl > :now`). See `fundamentals.md`.

A filter is also reasonable for narrowing within an item collection that is already small and bounded by the key condition.

---

## Projection expressions

A projection expression lists the attributes to return, working attribute by attribute within each item. Available on all read operations.

```js
{
  TableName: 'MovieRoles',
  KeyConditionExpression: '#actor = :actor',
  ProjectionExpression: '#actor, #movie, #role, #year, #genre',
  ExpressionAttributeNames: {
    '#actor': 'Actor', '#movie': 'Movie', '#role': 'Role',
    '#year': 'Year', '#genre': 'Genre'
  },
  ExpressionAttributeValues: { ':actor': { S: 'Tom Hanks' } }
}
```

- Use it to leave out large attributes (for example a ~350KB binary cover image) that the caller does not need.
- It can address nested elements of maps and lists, so one field of a large document can be fetched alone.
- It takes no `:` values, but `#` names are often needed (`Year` is reserved).

**Pitfall: same ordering problem as filters.** Projection is applied after items are read and after the 1MB limit is counted, so large attributes still consume capacity and still force pagination even when they are not returned.

Fix when it matters: create a secondary index with a custom projection that copies only the small attributes. Queries on that index read small items and return many more per page.

---

## Condition expressions

Available on every write: `PutItem`, `UpdateItem`, `DeleteItem`, and in transactions. The condition is evaluated against the current item with that primary key. If it is false, the write is cancelled and the request fails with a conditional check error.

(The book states that conditions also apply to batch writes. Not from the book: `BatchWriteItem` does not accept condition expressions, so conditional multi-item writes need individual requests or `TransactWriteItems`.)

Why they matter: without them you would read the item, check it in application code, then write, which costs an extra request and leaves a race window between the read and the write. A condition makes check-and-write a single atomic operation.

Because the target item is already identified by the `Key` (or by the item's key attributes in a put), a condition may reference **any** attribute, not only keys.

Operators: `=`, `<`, `<=`, `>`, `>=`, `BETWEEN`, combinable with `AND`, `OR`, `NOT`.

| Function | Asserts |
|---|---|
| `attribute_exists(path)` | The attribute is present |
| `attribute_not_exists(path)` | The attribute is absent. On a key attribute, this means "no item with this key exists". |
| `attribute_type(path, :type)` | The attribute has the given type |
| `begins_with(path, :prefix)` | The value starts with the given substring |
| `contains(path, :operand)` | A string contains a substring, or a set contains a value |
| `size(path)` | String length, binary byte length, or element count of a list, map, or set. Compared with a number. |

### Idiom: create-only put (uniqueness)

`PutItem` overwrites by default. Guard it with `attribute_not_exists` on the partition key. If an item with this primary key exists, it necessarily has that attribute, so the condition fails and nothing is overwritten.

```js
{
  TableName: 'Users',
  Item: {
    Username: { S: 'bountyhunter1' },
    Name: { S: 'Boba Fett' },
    CreatedAt: { S: new Date().toISOString() }
  },
  ConditionExpression: 'attribute_not_exists(#username)',
  ExpressionAttributeNames: { '#username': 'Username' }
}
```

This should be the default for creating entities: the large majority of `PutItem` calls should carry this condition. It only enforces uniqueness of the primary key. Uniqueness on any other attribute needs a separate item keyed on that attribute, written in the same transaction.

### Idiom: guard an update against a bad state

Use a condition to stop an update from producing invalid data, such as a balance going below zero.

```js
{
  TableName: 'Accounts',
  Key: { AccountId: { S: 'acct-1' } },
  ConditionExpression: '#balance >= :amount',
  UpdateExpression: 'SET #balance = #balance - :amount',
  ExpressionAttributeNames: { '#balance': 'Balance' },
  ExpressionAttributeValues: { ':amount': { N: '50' } }
}
```

### Idiom: limit in-progress items or group size

Keep a tracker item holding a set of IDs. Add to the set only while it is below the cap.

```js
{
  TableName: 'WorkQueue',
  Key: { PK: { S: 'Tracker' } },
  ConditionExpression: 'size(#inprogress) < :max',
  UpdateExpression: 'ADD #inprogress :id',
  ExpressionAttributeNames: { '#inprogress': 'InProgress' },
  ExpressionAttributeValues: {
    ':id': { SS: ['job-123'] },
    ':max': { N: '10' }
  }
}
```

If the condition fails, the group is full and the caller waits or retries. Mind the off-by-one: the book's example uses `size(#inprogress) <= 10`, which admits an eleventh entry; use `<` with the cap for a strict maximum.

### Idiom: assert the caller's permission on the item

Store the set of authorized usernames on the item and require membership.

```js
{
  TableName: 'BillingDetails',
  Key: { PK: { S: 'Amazon' } },
  ConditionExpression: 'contains(#a, :user)',
  UpdateExpression: 'SET #st = :type',
  ExpressionAttributeNames: { '#a': 'Admins', '#st': 'SubscriptionType' },
  ExpressionAttributeValues: {
    ':user': { S: 'Jeff Bezos' },
    ':type': { S: 'Pro' }
  }
}
```

The same shape covers "only the owner may delete": a `DeleteItem` with a condition such as `#owner = :user`.

### Idiom: check a different item with a transaction

A condition on a single-item write can only inspect that item. When the fact to assert lives on another item, use `TransactWriteItems` with a `ConditionCheck`, which asserts a condition on an item without modifying it. All operations succeed or fail together.

```js
// Delete an org's billing record only if the caller is in the org's Admins item
{
  TransactItems: [
    {
      ConditionCheck: {
        TableName: 'SaasApp',
        Key: { PK: { S: 'Admins#<orgId>' } },
        ConditionExpression: 'contains(#a, :user)',
        ExpressionAttributeNames: { '#a': 'Admins' },
        ExpressionAttributeValues: { ':user': { S: '<username>' } }
      }
    },
    {
      Delete: {
        TableName: 'SaasApp',
        Key: { PK: { S: 'Billing#<orgId>' } }
      }
    }
  ]
}
```

- A transaction mixes `Put`, `Update`, `Delete`, and `ConditionCheck` operations, each with its own optional condition.
- The book gives a limit of 10 items per transaction. Not from the book: the service limit has since been raised to 100 items.
- This pattern suits shared facts (an admin list, a parent's existence) that would be wasteful to duplicate onto every item they guard.

---

## Update expressions

Used only with `UpdateItem` (and `Update` operations inside a transaction). Unlike the other expressions, it changes the item.

`UpdateItem` versus `PutItem`: an update changes only what the expression names and leaves every other attribute intact, creating the item if it is missing. A put replaces the entire item with exactly the attributes supplied. Use update for partial changes and put for full replacement.

| Verb | Does | Syntax |
|---|---|---|
| `SET` | Add or overwrite an attribute; also arithmetic on numbers | `SET #a = :v`, `SET #n = #n + :inc` |
| `REMOVE` | Delete an attribute, or a nested element of a list or map | `REMOVE #a` |
| `ADD` | Add to a number, or insert elements into a set | `ADD #n :num`, `ADD #set :elements` |
| `DELETE` | Remove elements from a set | `DELETE #set :elements` |

Syntax rules:

- `SET` uses `=`. `ADD` and `DELETE` take the attribute and the value separated by a space, with no `=`.
- Several operations under one verb: state the verb once and separate clauses with commas.
- Several verbs in one expression: write them one after another with nothing between the clauses.
- Any combination of the four verbs may appear in a single expression.

```js
UpdateExpression: 'SET #name = :name, #updatedAt = :updatedAt REMOVE #inProgress'
```

### Set or overwrite an attribute

```js
{
  TableName: 'Users',
  Key: { Username: { S: 'python_fan' } },
  UpdateExpression: 'SET #picture = :url',
  ExpressionAttributeNames: { '#picture': 'ProfilePictureUrl' },
  ExpressionAttributeValues: { ':url': { S: 'https://example.com/pic.png' } }
}
```

Works whether or not the attribute existed before.

### Remove an attribute

```js
{
  TableName: 'Users',
  Key: { Username: { S: 'python_fan' } },
  UpdateExpression: 'REMOVE #picture',
  ExpressionAttributeNames: { '#picture': 'ProfilePictureUrl' }
}
```

Besides plain cleanup, this is how an item is taken **out of a sparse secondary index**: an item appears in an index only if it has the index's key attributes, so removing them (for example when a message is marked as read) drops the item from the index.

### Increment or decrement a number

```js
{
  TableName: 'PageViews',
  Key: { Page: { S: 'ContactUsPage' } },
  UpdateExpression: 'SET #views = #views + :inc',
  ExpressionAttributeNames: { '#views': 'PageViews' },
  ExpressionAttributeValues: { ':inc': { N: '1' } }
}
```

The arithmetic happens server-side and atomically: no read-then-write round trip and no lost updates under concurrency. Pair with `ReturnValues: 'UPDATED_NEW'` to get the new value back.

Not from the book: `SET #views = #views + :inc` fails if the attribute does not exist yet. Either use `ADD #views :inc` (treats a missing number as 0) or `SET #views = if_not_exists(#views, :zero) + :inc`.

### Set a nested property

```js
{
  TableName: 'Users',
  Key: { Username: { S: 'python_fan' } },
  UpdateExpression: 'SET #phone.#mobile = :cell',
  ExpressionAttributeNames: { '#phone': 'PhoneNumbers', '#mobile': 'MobileNumber' },
  ExpressionAttributeValues: { ':cell': { S: '+1-555-555-5555' } }
}
```

Updates one key inside a map without reading or rewriting the whole map. Not from the book: the parent map (`PhoneNumbers`) must already exist on the item, otherwise the update fails with an invalid document path error.

### Add to and remove from a set

```js
// Add one or more elements (idempotent: existing elements are ignored, no error)
{
  TableName: 'SaasApp',
  Key: { PK: { S: 'Admins#<orgId>' } },
  UpdateExpression: 'ADD #a :users',
  ExpressionAttributeNames: { '#a': 'Admins' },
  ExpressionAttributeValues: { ':users': { SS: ['an_admin_user', 'another_user'] } }
}

// Remove one or more elements
{
  TableName: 'SaasApp',
  Key: { PK: { S: 'Admins#<orgId>' } },
  UpdateExpression: 'DELETE #a :users',
  ExpressionAttributeNames: { '#a': 'Admins' },
  ExpressionAttributeValues: { ':users': { SS: ['an_admin_user'] } }
}
```

- The value passed to `ADD` or `DELETE` for a set is itself a set (`SS`, `NS`, `BS`), even for a single element.
- Set adds are idempotent, so they are safe to retry.
- Use `DELETE`, not `REMOVE`, to take elements out of a set. `REMOVE` deletes the whole attribute and takes no value.

---

## Pitfall summary

| Pitfall | What happens | Do instead |
|---|---|---|
| Filter expression used as a query mechanism | The 1MB read happens before filtering; you pay for and page through everything, often getting empty pages | Put the attribute into a primary key or index key |
| Treating an empty page as end of results | Matches on later pages are missed | Loop until `LastEvaluatedKey` is absent |
| Projection expected to cut read cost | Full items are still read and counted toward 1MB | Query an index with a narrow custom projection |
| `PutItem` without a condition | Silently overwrites an existing item | `attribute_not_exists(<partition key>)` |
| Read, check in code, then write | Extra request plus a race condition | Condition expression on the write |
| Condition needs data from another item | A single-item condition cannot see it | `TransactWriteItems` with a `ConditionCheck` |
| Attribute name is a reserved word or contains a period | Request is rejected or the path is misread as nested access | Always use `#` placeholders |
| Value sent with the wrong type | String and number forms of the same value never match | Keep each attribute's type consistent everywhere |
| `ConsistentRead` on a GSI | Not supported; GSIs are always eventually consistent | Read from the base table or an LSI when strong consistency is needed |
| Paging forward to reach the newest items | Reads the whole collection | `ScanIndexForward: false` with `Limit` |
| `PutItem` used for a partial change | Attributes not supplied are lost | `UpdateItem` |
| `REMOVE` used to take an element out of a set, or `SET` written without `=` | Invalid update expression | `DELETE #set :elements`; `SET #a = :v` |
| LSI item collection grows unnoticed | Writes rejected at 10GB | `ReturnItemCollectionMetrics` on writes and alert at 7 to 8GB |
| Scan on a request path | Latency and cost grow with table size | Query on a designed item collection |
