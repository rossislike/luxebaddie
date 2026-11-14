# Implementation Patterns: From a Finished Data Model to Application Code

How the book's five Node.js example services turn an entity chart into code: project layout, entity classes, one data function per access pattern, conditional and transactional writes, query shapes, table definition, stream handlers, and migration scripts. Read this when the model (entities, PK/SK/GSI patterns, access patterns) is settled and you are about to write or review the data access layer.

## Contents

1. [SDK and client used by the examples](#1-sdk-and-client-used-by-the-examples)
2. [Project layout](#2-project-layout)
3. [Entity classes](#3-entity-classes)
4. [Data access functions](#4-data-access-functions)
5. [Write patterns](#5-write-patterns)
6. [Transaction cancellation reasons](#6-transaction-cancellation-reasons)
7. [Query patterns](#7-query-patterns)
8. [Update expressions and ReturnValues](#8-update-expressions-and-returnvalues)
9. [Table definition](#9-table-definition)
10. [Stream handlers and fan-out](#10-stream-handlers-and-fan-out)
11. [Migration scripts](#11-migration-scripts)
12. [IDs, timestamps, padding](#12-ids-timestamps-padding)
13. [Defects in the example code to avoid copying](#13-defects-in-the-example-code-to-avoid-copying)
14. [Checklist](#14-checklist)

---

## 1. SDK and client used by the examples

| Aspect | What the examples use |
|---|---|
| SDK | AWS SDK for JavaScript **v2** (`aws-sdk` `^2.638.0`), Node.js 12 Lambda runtime |
| Client | **Low-level** `new AWS.DynamoDB()`, not `DocumentClient`. Every value is typed: `{ 'S': '...' }`, `{ 'N': '5' }`, `{ 'M': {...} }`, `{ 'SS': [...] }` |
| Call style | `dynamodb.getItem(params).promise()` with `async/await`; errors are matched on `error.code` |
| Deployment | Serverless Framework: `serverless.yml` holds the table (raw CloudFormation), IAM, Lambda functions, API Gateway routes |
| HTTP glue | `middy` (JSON body parser, JSON-schema validator, HTTP error handler) |
| IDs | `ksuid` for sortable IDs, `uuid` v4 for the session token |

**Why no ORM/ODM:** an object mapper assumes one object type per table and relations by foreign key. A single-table model puts many types in one table (sometimes several per item), and how you fetch related items depends entirely on the key design, so a mapper pushes you toward the wrong model. It also saves little: DynamoDB is API-driven, so a mapper mostly repeats SDK parameters. Two acceptable helpers per the book: a thin value-marshalling wrapper (`DocumentClient`, boto3 `Table`), and entity-definition helpers that are explicitly not ORMs (DynamoDB Toolbox). The example code chose the low-level client; because all type marshalling is confined to entity classes, that verbosity never leaks.

> **Not from the book:** in AWS SDK for JavaScript v3 the same request parameters are passed to command objects, for example `client.send(new QueryCommand({ TableName, KeyConditionExpression, ... }))` from `@aws-sdk/client-dynamodb`. There is no `.promise()`, and errors are matched on `error.name` (a `TransactionCanceledException` exposes `CancellationReasons` directly, so the v2 `extractError` workaround in section 6 is unnecessary). The snippets below stay in the v2 form the examples use.

---

## 2. Project layout

```
serverless.yml   table, indexes, IAM, functions, routes, stream subscription
entities/        one module per entity family + index.js re-exporting everything
data/            one module per access pattern + index.js + utils.js (transaction helper)
handlers/        one Lambda handler per endpoint + utils.js (middy wrapper)
migrations/      one-off scan-and-update scripts, deployed as Lambda functions
```

| Layer | Owns | Must not do |
|---|---|---|
| `entities/` | Key templates (`PK`, `SK`, `GSInPK/SK`), typed attribute marshalling (`toItem`), parsing (`xFromItem`), input invariants (required fields, enum values), ID generation | Call DynamoDB |
| `data/` | Exactly one DynamoDB use case per module: build the request from entity methods, call the API, map results to entities, translate failures to an error string | Know about HTTP; hand-build key strings |
| `handlers/` | Validate the request (JSON schema), instantiate the entity from path/body values, call one data function, map `{ error }` to a status code | Touch the SDK or see `PK`/`SK` |

The rule behind the layout: **implement the data model at the very boundary of the application**. Items coming out of DynamoDB carry indexing attributes and type-wrapped values, both meaningless to business logic. Convert once at the edge and work with plain application objects everywhere else.

A handler typically builds a partial entity just to get keys, then passes it down:

```js
const handler = async event => {
  const customer_obj = new Customer({ username: event.pathParameters.username })
  const { customer, orders, error } = await getOrdersForCustomer({ customer: customer_obj })
  const statusCode = error ? 500 : 200
  const body = error ? JSON.stringify({ error }) : JSON.stringify({ customer, orders })
  return { statusCode, body }
}
module.exports.handler = makeHandler({ handler, inputSchema })
```

The book also recommends small CLI scripts, one per access pattern, that take the pattern's inputs (a username, an order ID), call the data function, and print the result. Write them alongside the data functions; they are far more useful than the console for debugging overloaded keys. (The example repos ship Postman collections instead.)

---

## 3. Entity classes

One class per entity type. Shape used consistently across all examples:

```js
class Order {
    constructor({ username, orderId, address, createdAt = new Date(), status = 'PLACED', totalAmount, numberItems }) {
        if (!username) throw new Error('Order must include a username')
        this.username = username
        this.orderId = orderId ? orderId : generateOrderId(createdAt)   // KSUID
        if (status && !STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`)
        this.status = status
        // ...
    }

    key() {
        return {
            'PK': { 'S': `CUSTOMER#${this.username}` },
            'SK': { 'S': `#ORDER#${this.orderId}` }
        }
    }

    gsi1() {
        return {
            'GSI1PK': { 'S': `ORDER#${this.orderId}` },
            'GSI1SK': { 'S': `ORDER#${this.orderId}` }
        }
    }

    toItem() {
        return {
            ...this.key(),
            ...this.gsi1(),
            'Type': { 'S': 'Order' },
            'Username': { 'S': this.username },
            'OrderId': { 'S': this.orderId },
            'CreatedAt': { 'S': this.createdAt.toISOString() },
            'Status': { 'S': this.status },
            'TotalAmount': { 'N': this.totalAmount.toString() },
        }
    }
}

const orderFromItem = (attributes) => new Order({
    username: attributes.Username.S,
    orderId: attributes.OrderId.S,
    createdAt: attributes.CreatedAt.S,
    status: attributes.Status.S,
    totalAmount: attributes.TotalAmount.N,
})
```

Rules the examples follow:

| Rule | Detail and reason |
|---|---|
| Constructor takes one destructured object | Only identifying fields are required, so a handler can build a "key-only" entity (`new Customer({ username })`) to address an item. Defaults cover `createdAt = new Date()`, counters `= 0`, status. |
| Key methods return typed values | `key()` returns the full `{ PK, SK }` map, usable directly as `Key:` in GetItem/UpdateItem/ConditionCheck. Larger models also expose `pk()`, `sk()`, `gsi1pk()`, `gsi1sk()` returning a single `{ 'S': ... }` for use in `ExpressionAttributeValues`. One method per index: `gsi1()`, `gsi2()`, ... |
| Key templates live only in the entity | Data functions never concatenate key strings. Changing a key pattern is a one-file change, and migrations reuse the same methods. |
| `toItem()` = keys + index keys + `Type` + application attributes | Spread order: `...this.key(), ...this.gsi1(), 'Type', attrs`. Optional attributes are added conditionally (`if (this.description) item.Description = ...`) so missing values are simply absent from the item. |
| `<entity>FromItem(item)` is a module-level function | Reads only application attributes and rebuilds the object; ignores `PK`/`SK`/`GSI*`. Guard optional attributes: `attributes.Description ? attributes.Description.S : undefined`. |
| Always write a `Type` attribute | Used to split mixed Query results, to filter Scans in migrations, to filter stream records, and to re-normalize exports for analytics. |
| Keep application attributes even when they are encoded in keys | `Username` is stored separately although `PK` is `USER#<username>`. Never parse business data back out of a key: key formats change during migrations, and casing may be normalized in keys. Costs a little storage, buys safe refactoring. |
| Normalize inside key methods | Keys use `this.name.toUpperCase()` or `.toLowerCase()`; the application attribute keeps the original casing. |
| Do not share an attribute between indexes | Each GSI gets its own `GSI<n>PK`/`GSI<n>SK` even if a value equals `SK` today. Reuse ties unrelated access patterns together and blocks later changes. |
| Type guard where two entities share a key shape | User and Organization are both `ACCOUNT#<name>`; `userFromItem` throws if `item.Type.S !== 'User'`. |

Variants worth copying:

- **Sparse index:** return the GSI keys only when the item should be indexed.
  ```js
  gsi1() {
      if (this.unread) {
          return { 'GSI1PK': this.pk(), 'GSI1SK': { 'S': `MESSAGES#${this.messageId}` } }
      }
      return {}
  }
  ```
- **State-dependent sort key:** `gsi4sk()` returns `ISSUE#OPEN#<9999999 - number, padded>` for open issues and `#ISSUE#CLOSED#<padded number>` otherwise. Any update that changes the state must rewrite the index keys (section 8).
- **Embedded value objects:** nested classes expose `toMap()` returning `{ 'M': {...} }` (addresses), or are stored as a JSON string via `toString()` (payment plan, code of conduct, featured deals) when they are always read and written whole.
- **Reference-counted map with fixed keys:** `formatReactions()` writes every reaction type with a default of `0` so later `SET #reactions.#r = #reactions.#r + :inc` never hits a missing path.
- **Marker/uniqueness entities** (`CustomerEmail`, `BrandLike`, `Star`, reaction trackers) are full entity classes with `key()` and `toItem()`, even if never read back.
- **Singleton items:** `FrontPage`, `EditorsChoice`, `BrandContainer` have constant keys (`FRONTPAGE`/`FRONTPAGE`).
- **Shared base class** for families with the same shape: `Like`/`Watch` extend `Interaction`; `IssueComment`/`PRComment` extend `Comment`; the subclass supplies `type`.
- **Shortened attribute names** (advanced, only for very large tables): because the mapping lives in `toItem`/`fromItem`, application attributes can be stored as `u`, `fn`, `ln` to cut storage without the rest of the code noticing. The examples do not do this.

---

## 4. Data access functions

One exported async function per access pattern, named after it: `getOrdersForCustomer`, `addStarToRepo`, `getRepoAndIssues`, `markMessageRead`. `data/index.js` re-exports them all.

```js
const AWS = require('aws-sdk')
const dynamodb = new AWS.DynamoDB()
const { customerFromItem } = require('../entities')

const getCustomer = async ({ customer }) => {
    try {
        const resp = await dynamodb.getItem({
            TableName: process.env.TABLE_NAME,
            Key: customer.key()
        }).promise()
        if (!resp.Item) {
            return { error: 'Customer does not exist.' }
        }
        return { customer: customerFromItem(resp.Item) }
    } catch(error) {
        console.log('Error retrieving customer')
        console.log(error)
        return { error: 'Could not retrieve customer' }
    }
}
```

Conventions:

- **Input:** entity instances (or a few scalars); **output:** an object of entity instances, or `{ error: '<message>' }`. Data functions do not throw to the handler. The handler destructures `{ x, error }`.
- **Table name** from `process.env.TABLE_NAME` (set in `serverless.yml` via `Ref`); index names are literals (`'GSI1'`).
- **Request building:** `Key`/`Item` come from `entity.key()`/`entity.toItem()`; key condition values come from `entity.pk()` or `entity.key()['PK']`. Every attribute name goes through `ExpressionAttributeNames` (`'#pk': 'PK'`, `'#status': 'Status'`), which sidesteps reserved words and lets names be dynamic (`'#name': name`).
- **Error mapping:** a generic default message, upgraded to a specific one when `error.code === 'ConditionalCheckFailedException'` (single-item writes) or when a transaction's cancellation reasons identify the failed condition (section 6). "Not found" on reads is an `error` result, not an exception.
- **Helper entities are built inside the data function:** `likeBrandForUser({ brandLike })` constructs a key-only `Brand` and `User` to get their keys for the transaction.
- **Two independent reads run in parallel** when one Query cannot serve the pattern: `Promise.all([getBrand(...), getLatestDealsForBrand(...)])`, merging the results.

---

## 5. Write patterns

| Need | Pattern in the examples |
|---|---|
| Create, fail if it exists | `PutItem` with `ConditionExpression: 'attribute_not_exists(PK)'` |
| Unconditional overwrite (singleton pages) | Plain `PutItem` with `Item: page.toItem()` |
| Update, fail if missing | `UpdateItem` with `ConditionExpression: 'attribute_exists(PK)'` (UpdateItem would otherwise create the item) |
| Unique on two attributes | Transaction with two `Put`s, each `attribute_not_exists(PK)` |
| Create child + bump parent counter | Transaction: `Put` (not exists) + `Update` parent `SET #c = #c + :inc` with `attribute_exists(PK)` |
| Create only if a related item exists | Transaction: `Put` + `ConditionCheck` with `attribute_exists(PK)` |
| At most one of each kind per user | `Update` with `ADD` to a string set, guarded by `NOT contains(...)` |
| Guard on entity type when keys collide | `ConditionExpression: 'attribute_exists(PK) AND #type = :type'` |
| Sequential number from a counter | `UpdateItem` increment with `ReturnValues`, then `PutItem` using the returned number |

**Create-only write.** `attribute_not_exists(PK)` is evaluated against the item with the same full primary key, so it means "no item with this PK+SK exists". Without it, PutItem silently overwrites.

```js
await dynamodb.putItem({
    TableName: process.env.TABLE_NAME,
    Item: deal.toItem(),
    ConditionExpression: 'attribute_not_exists(PK)'
}).promise()
```

**Uniqueness on more than one attribute.** DynamoDB only enforces uniqueness on the primary key, so each additional unique value gets its own marker item, written atomically with the main item:

```js
const params = {
    TransactItems: [
        { Put: { Item: customer.toItem(), TableName: process.env.TABLE_NAME,
                 ConditionExpression: 'attribute_not_exists(PK)' } },        // CUSTOMER#<username>
        { Put: { Item: customerEmail.toItem(), TableName: process.env.TABLE_NAME,
                 ConditionExpression: 'attribute_not_exists(PK)' } }         // CUSTOMEREMAIL#<email>
    ]
}
await executeTransactWrite({ client: dynamodb, params })
```

**Parent with children in one write.** `createOrder` builds one `Put` for the Order (create-only) and pushes one `Put` per OrderItem into the same `TransactItems` array. A transaction has a maximum item count, so this only works for orders with a bounded number of items; check the current limit before relying on it.

**Counter / reference count with a tracking item.** The tracking item (Star, BrandLike, Membership) makes the operation idempotent; the count on the parent is only incremented when the tracking item is new; a `ConditionCheck` asserts a third item exists without modifying it.

```js
TransactItems: [
    { Put: { Item: brandLike.toItem(), TableName: process.env.TABLE_NAME,
             ConditionExpression: 'attribute_not_exists(PK)' } },
    { Update: { Key: brand.key(), TableName: process.env.TABLE_NAME,
                ConditionExpression: 'attribute_exists(PK)',
                UpdateExpression: 'SET #likeCount = #likeCount + :inc',
                ExpressionAttributeNames: { '#likeCount': 'LikeCount' },
                ExpressionAttributeValues: { ':inc': { 'N': '1' } } } },
    { ConditionCheck: { Key: user.key(), TableName: process.env.TABLE_NAME,
                        ConditionExpression: 'attribute_exists(PK)' } }
]
```

`SET #c = #c + :inc` requires the attribute to exist, which is why counter attributes are always written with `0` at creation.

**One reaction of each type per user.** A single tracking item per (target, user) holds a string set; the condition rejects a repeat, and the same transaction increments the nested counter on the target:

```js
{ Update: { Key: issueReaction.key(), TableName: process.env.TABLE_NAME,
            ConditionExpression: 'attribute_not_exists(#reaction) OR NOT contains(#reaction, :reaction)',
            UpdateExpression: 'ADD #reaction :reactionSet',
            ExpressionAttributeNames: { '#reaction': 'Reaction' },
            ExpressionAttributeValues: { ':reaction': { 'S': reaction }, ':reactionSet': { 'SS': [ reaction ] } } } },
{ Update: { Key: issue.key(), TableName: process.env.TABLE_NAME,
            ConditionExpression: 'attribute_exists(PK)',
            UpdateExpression: 'SET #reactions.#reaction = #reactions.#reaction + :inc',
            ExpressionAttributeNames: { '#reactions': 'Reactions', '#reaction': reaction },
            ExpressionAttributeValues: { ':inc': { 'N': '1' } } } }
```

**Maintaining a set of names in a singleton item.** `createBrand` puts the Brand (create-only) and, in the same transaction, `ADD #brands :brand` with `{ 'SS': [ brand.name ] }` on the `BRANDS` container item. `ADD` on a set creates the attribute (and the item) if absent.

**Keeping a denormalized copy in sync.** `addMemberToOrganization` writes the Membership, increments `Members` on the Organization, and sets `Organizations.<org>` = role on the User item, all in one transaction.

**Sequential IDs (issue and pull request numbers).** Two separate requests, deliberately not a transaction, because the new number is only known after the increment:

```js
const resp = await dynamodb.updateItem({
    TableName: process.env.TABLE_NAME,
    Key: repo.key(),
    ConditionExpression: 'attribute_exists(PK)',
    UpdateExpression: 'SET #count = #count + :inc',
    ExpressionAttributeNames: { '#count': 'IssueAndPullRequestCount' },
    ExpressionAttributeValues: { ':inc': { 'N': '1' } },
    ReturnValues: 'ALL_NEW'
}).promise()
issue.issueNumber = repoFromItem(resp.Attributes).issueAndPullRequestCount
// then PutItem issue.toItem() with attribute_not_exists(PK)
```

If the second write fails, a number is skipped; that is accepted. The atomic increment guarantees no two writers get the same number.

---

## 6. Transaction cancellation reasons

A failed `TransactWriteItems` returns `TransactionCanceledException` with a `CancellationReasons` array that is **positionally aligned with `TransactItems`**. SDK v2 does not surface that array on the error object, so every example repo ships this helper in `data/utils.js`:

```js
const executeTransactWrite = async ({ client, params }) => {
    const transactionRequest = client.transactWriteItems(params)
    let cancellationReasons
    transactionRequest.on('extractError', (response) => {
        try {
            cancellationReasons = JSON.parse(response.httpResponse.body.toString()).CancellationReasons
        } catch (err) {
            console.error('Error extracting cancellation error', err)
        }
    })
    return new Promise((resolve, reject) => {
        transactionRequest.send((err, response) => {
            if (err) {
                err.cancellationReasons = cancellationReasons
                return reject(err)
            }
            return resolve(response)
        })
    })
}
```

The caller maps the index of the failed condition to a message, which is why the order of `TransactItems` is part of the function's contract:

```js
let errorMessage = 'Could not like brand'
if (error.code === 'TransactionCanceledException') {
    if (error.cancellationReasons[0].Code === 'ConditionalCheckFailed') {
        errorMessage = 'User has already liked this brand.'
    } else if (error.cancellationReasons[1].Code === 'ConditionalCheckFailed') {
        errorMessage = 'Brand does not exist.'
    } else if (error.cancellationReasons[2].Code === 'ConditionalCheckFailed') {
        errorMessage = 'User does not exist.'
    }
}
return { error: errorMessage }
```

Note the two spellings: `ConditionalCheckFailedException` is `error.code` for single-item writes; `ConditionalCheckFailed` is the per-item `Code` inside cancellation reasons. Guard against `cancellationReasons` being undefined (the helper swallows parse failures) before indexing into it.

---

## 7. Query patterns

**Parent plus children in one Query.** Works when both live in the same item collection (base table or GSI). The examples never inspect `Type` to split the page; they rely on sort order to put the parent at a known end and take it with `shift()`:

```js
const resp = await dynamodb.query({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: '#pk = :pk',
    ExpressionAttributeNames: { '#pk': 'PK' },
    ExpressionAttributeValues: { ':pk': customer.key()['PK'] },
    ScanIndexForward: false
}).promise()
if (!resp.Items.length) return { error: 'Customer does not exist.' }
const cust = customerFromItem(resp.Items.shift())
const orders = resp.Items.map((item) => orderFromItem(item))
```

This is why child sort keys carry a `#` prefix (`#ORDER#<id>` sorts before `CUSTOMER#<name>`): reading backward returns the parent first, then children newest-first. The positional approach is only safe when the queried range contains exactly the parent and one child type and the parent is guaranteed to be in the page. When a collection mixes more types, or the parent may be missing, split on the Type attribute instead (adapted, not in the example repos):

```js
const parentItem = resp.Items.find((item) => item.Type.S === 'Repo')
const issues = resp.Items.filter((item) => item.Type.S === 'Issue').map(issueFromItem)
```

**Direction, range, and Limit by collection layout:**

| Layout in the collection | Request | Example |
|---|---|---|
| Children sort before parent; want parent + newest children | `#pk = :pk`, `ScanIndexForward: false`, optional `Limit` | Customer + Orders; Account + Repos on GSI3 (`Limit: 11` = 1 parent + 10) |
| Children after parent; other types before it | `#pk = :pk AND #sk >= :sk` with the parent's own SK, forward | Repo + Stars (`Limit: 26`); Repo + app installations on GSI1 |
| Children before parent; other types after it | `#pk = :pk AND #sk <= :sk` with the parent's SK, `ScanIndexForward: false` | User + Gists (`Limit: 11`) |
| Parent sits between two child groups | Choose operator and direction from a parameter | Repo + open issues: `>=`, forward; Repo + closed issues: `<=`, backward (GSI4) |
| Children only | `#pk = :pk` on a partition holding only them | Comments for an issue; a user's messages |
| Same query, optional sparse index | Build params, then swap in `IndexName` and the key attribute name | Unread messages: `params.IndexName = 'GSI1'`, `'#pk': 'GSI1PK'` |

`Limit` counts the parent, hence 11 and 26. Sort keys compare as strings, so numeric parts must be zero-padded, and "newest first within an ascending read" is done by storing `9999999 - number` (section 12).

Before the migration, the GitHub example fetched issues by status with `FilterExpression: 'attribute_not_exists(#status) OR #status = :status'` on the repo partition (the `attribute_not_exists` arm keeps the Repo item). A filter is applied after items are read, so it does not reduce read cost and interacts badly with `Limit`; the migrated version replaces it with status encoded in `GSI4SK`. Treat a filter on a hot access pattern as a signal the key design needs another index.

**Pagination.** `Query` and `Scan` return at most 1 MB per call. Loop while `LastEvaluatedKey` is present, passing it back as `ExclusiveStartKey`:

```js
const queryParams = {
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: '#pk = :pk',
    ExpressionAttributeNames: { '#pk': 'PK' },
    ExpressionAttributeValues: { ':pk': brandWatch.pk() }
}
while (true) {
    const results = await dynamodb.query(queryParams).promise()
    // ... process results.Items page by page ...
    if (!results.LastEvaluatedKey) break
    queryParams.ExclusiveStartKey = results.LastEvaluatedKey
}
```

The user-facing list endpoints in the examples return a single limited page and do not expose a cursor; only the background loops paginate. For API pagination, return `LastEvaluatedKey` (encoded) to the caller and accept it back.

**Multi-partition reads (time-bucketed partitions).** Deals are indexed under one partition per day (`GSI1PK = DEALS#<truncated timestamp>`), so "latest 25 deals" walks backward one bucket at a time until the limit is met or a bucket cap is reached:

```js
const getLatestDeals = async ({ createdAt = new Date(), limit = 25, count = 0 }) => {
    let deals = []
    const resp = await dynamodb.query({
        TableName: process.env.TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: '#gsi1pk = :gsi1pk',
        ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK' },
        ExpressionAttributeValues: { ':gsi1pk': dealGSI1PK(createdAt) },
        ScanIndexForward: false,
        Limit: limit
    }).promise()
    resp.Items.forEach((item) => deals.push(dealFromItem(item)))

    if (deals.length < limit && count < 5) {
        const { deals: moreDeals } = await getLatestDeals({
            createdAt: new Date(createdAt.setDate(createdAt.getDate() - 1)),
            limit: limit - deals.length,
            count: count + 1
        })
        deals = deals.concat(moreDeals)
    }
    return { deals }
}
```

Always cap the number of buckets visited, or an empty dataset loops forever. The same function shape serves brand (`GSI2`) and category (`GSI3`) buckets, with the bucket key coming from `brand.gsi2pk(timestamp)`.

**Read-sharded cache items (book only, not in the example code).** For a very hot read, store N identical copies of a precomputed result under `DEALSCACHE#<n>` and read a random one with GetItem; raise N by writing more copies and widening the random range.

**BatchGetItem (book only, not in the example code).** None of the five repos call `batchGetItem`. The book uses it as the second step of a two-step read for highly mutable many-to-many data: Query the relationship items, then BatchGet the authoritative items they point to. If you implement it, build `Keys` from `entity.key()` and handle the unprocessed keys the API can return.

---

## 8. Update expressions and ReturnValues

Expressions in the examples are static strings with name and value placeholders; values come from the entity.

| Operation | Expression |
|---|---|
| Set scalar attributes | `SET #title = :title, #content = :content, #status = :status` |
| Set or replace one key in a map | `SET #addresses.#name = :address` with `'#name': name`, `':address': address.toMap()` |
| Remove one key from a map | `REMOVE #addresses.#name` |
| Increment a counter | `SET #count = #count + :inc` with `':inc': { 'N': '1' }` |
| Increment a nested counter | `SET #reactions.#reaction = #reactions.#reaction + :inc` |
| Add to a string set | `ADD #brands :brand` with `{ 'SS': [ name ] }` |
| Leave a sparse index | `SET #unread = :false REMOVE #gsi1pk, #gsi1sk` |
| Change state that is encoded in an index key | `SET #status = :status, #gsi4pk = :gsi4pk, #gsi4sk = :gsi4sk` with values from `issue.gsi4pk()` / `issue.gsi4sk()` |

Rules:

- Every user-facing update carries `ConditionExpression: 'attribute_exists(PK)'` and maps `ConditionalCheckFailedException` to "X does not exist."
- **Index keys are ordinary attributes; DynamoDB does not recompute them.** When an update changes anything a `GSInSK` template depends on (status, unread flag, timestamp), the same UpdateItem must set or remove those index attributes, using the entity's key methods on an instance holding the new values.
- `ReturnValues: 'ALL_NEW'` is the only setting the example code uses: the response's `Attributes` is the complete post-update item, fed straight into `xFromItem` to return the fresh entity without a second read. The book's prose for counter-derived numbers uses `UPDATED_NEW` (only the changed attributes), which is enough when you just need the new counter value.
- The handler builds an entity from the request (`new Order({ orderId, username, status })`); the entity constructor validates enums before any request is sent.

---

## 9. Table definition

The table is plain CloudFormation under `resources:` in `serverless.yml`:

```yaml
resources:
  Resources:
    EcommerceTable:
      Type: AWS::DynamoDB::Table
      Properties:
        AttributeDefinitions:
          - { AttributeName: "PK", AttributeType: "S" }
          - { AttributeName: "SK", AttributeType: "S" }
          - { AttributeName: "GSI1PK", AttributeType: "S" }
          - { AttributeName: "GSI1SK", AttributeType: "S" }
        KeySchema:
          - { AttributeName: "PK", KeyType: "HASH" }
          - { AttributeName: "SK", KeyType: "RANGE" }
        BillingMode: "PAY_PER_REQUEST"
        GlobalSecondaryIndexes:
          - IndexName: 'GSI1'
            KeySchema:
              - { AttributeName: "GSI1PK", KeyType: "HASH" }
              - { AttributeName: "GSI1SK", KeyType: "RANGE" }
            Projection:
              ProjectionType: ALL
```

| Setting | What the examples do |
|---|---|
| Attribute names | Generic `PK`, `SK`, `GSI<n>PK`, `GSI<n>SK`, all type `S`. Index names `GSI1`..`GSI5`. Only key attributes are declared; everything else is schemaless. |
| Billing | `PAY_PER_REQUEST` (on-demand) on every table |
| Projection | `ALL` on overloaded GSIs, so `xFromItem` works on index results. The session store's `UserIndex` is `KEYS_ONLY` because it only needs keys to delete. |
| Non-generic keys | The session store is a simple-key table: `SessionId` HASH, GSI `UserIndex` on `Username`. Generic names matter for overloaded single-table designs, not for one-entity tables. |
| Single-purpose sparse index | Big Time Deals adds a HASH-only `UserIndex` on a `UserIndex` attribute written only by User items, so a Scan of that index returns users only. |
| Streams | `StreamSpecification: { StreamViewType: 'NEW_IMAGE' }` |
| TTL | `TimeToLiveSpecification: { AttributeName: "TTL", Enabled: true }`; the attribute is epoch **seconds** as a Number: `{ 'N': (expiresAt.getTime() / 1000).toString() }`. A human-readable `ExpiresAt` ISO string is stored next to it. |
| Table name wiring | `environment: TABLE_NAME: { Ref: <Table> }` |

TTL deletion is asynchronous (the book cites up to 48 hours), so reads that must not return expired items also need a filter on the TTL attribute against the current epoch. The session-store example code omits this check; add it.

**IAM.** One role statement lists only the actions the service uses, against the table ARN and each index ARN explicitly:

```yaml
iamRoleStatements:
  - Effect: "Allow"
    Action:
      - "dynamodb:ConditionCheckItem"
      - "dynamodb:GetItem"
      - "dynamodb:PutItem"
      - "dynamodb:Query"
      - "dynamodb:UpdateItem"
    Resource:
      - Fn::GetAtt: [ GitHubTable, Arn ]
      - Fn::Join: [ "/", [ { Fn::GetAtt: [ GitHubTable, Arn ] }, "index/GSI1" ] ]
```

- Transactions are authorized through their member operations: `PutItem`, `UpdateItem`, and `ConditionCheckItem` (needed whenever a transaction contains a `ConditionCheck`).
- Add `BatchWriteItem` and `Scan` only for services that fan out or migrate; add each new `index/GSI<n>` ARN when an index is added.
- Stream consumers need a second statement on `<table arn>/stream/*`: `DescribeStream`, `GetRecords`, `GetShardIterator`, `ListStreams`.

**Deployment gotchas recorded in the migration repo:** CloudFormation allows creating only one new GSI per stack update (deploy GSI4, then GSI5), and the 200-resources-per-stack limit forced commenting out endpoints (each HTTP endpoint costs 5 to 6 resources).

---

## 10. Stream handlers and fan-out

Subscribe a function to the table stream:

```yaml
streamHandler:
  handler: handlers/streamHandler.handler
  events:
    - stream:
        type: dynamodb
        arn:
          Fn::GetAtt: [BigTimeDealsTable, StreamArn]
```

A single-table stream carries every entity type and every event type, so the handler filters on `eventName` and the `Type` attribute first, then reuses the normal `fromItem` parser because `NewImage` is in the same typed format as the low-level client:

```js
exports.handler = async event => {
  const deals = event.Records.filter((record) => {
    return record.eventName === 'INSERT' && record.dynamodb.NewImage.Type.S === 'Deal'
  }).map((record) => dealFromItem(record.dynamodb.NewImage))

  const brandPromises = deals.map((deal) => notifyBrandWatchers({ deal }))
  const categoryPromises = deals.map((deal) => notifyCategoryWatchers({ deal }))
  await Promise.all([ ...brandPromises, ...categoryPromises ])
}
```

**Fan-out shape** (`notifyBrandWatchers`, `sendHotDealToAllUsers`): page through the recipients, and for each page write one item per recipient with BatchWriteItem.

1. Source of recipients: a paginated Query on the watcher partition (`BRANDWATCH#<brand>`), or a paginated Scan of the sparse `UserIndex` for "all users".
2. Map each recipient to `{ PutRequest: { Item: new Message({...}).toItem() } }`.
3. Slice into chunks of 25 (the BatchWriteItem maximum).
4. Send each chunk; resend whatever comes back in `UnprocessedItems`, with a bounded number of attempts.

```js
const batches = Math.ceil(requestItems.length / 25)
for (let i = 0; i < batches; i++) {
    let pending = requestItems.slice(i * 25, (i + 1) * 25)
    let attempts = 0
    while (pending.length && attempts < 5) {
        const result = await dynamodb.batchWriteItem({
            RequestItems: { [process.env.TABLE_NAME]: pending }
        }).promise()
        pending = result.UnprocessedItems[process.env.TABLE_NAME] || []
        attempts++
    }
}
```

(The loop above is corrected relative to the repo; see section 13.) BatchWriteItem has no condition expressions and is not atomic, which is fine for generated messages with fresh KSUIDs. The session store uses the same API with `DeleteRequest: { Key: { SessionId: item.SessionId } }` built from a `KEYS_ONLY` index Query to delete all of a user's sessions.

**Parallel scan (book only, not in the example code).** The example fan-out and migration loops scan sequentially. To speed up a large Scan, run N workers that each pass `TotalSegments: N` and their own `Segment: 0..N-1`, each paginating independently; DynamoDB partitions the keyspace for you.

---

## 11. Migration scripts

Adding an index for existing items means back-filling its key attributes. The migration repo's scripts are Lambda functions without HTTP events (`handler: migrations/accountMigration.migrateAllAccounts`), invoked manually after deploying the new index.

Shape of every script:

1. `Scan` with a `FilterExpression` on `Type` to select only the entity types being decorated.
2. For each item: parse with the regular `xFromItem`, then `UpdateItem` setting the new index attributes from the entity's (newly added) key methods.
3. Follow `LastEvaluatedKey` until the table is exhausted.

```js
const scanParams = {
    TableName: process.env.TABLE_NAME,
    FilterExpression: '#type IN (:user, :org)',
    ExpressionAttributeNames: { '#type': 'Type' },
    ExpressionAttributeValues: { ':user': { 'S': 'User' }, ':org': { 'S': 'Organization' } }
}
while (true) {
    const results = await dynamodb.scan(scanParams).promise()
    await Promise.all(results.Items.map((item) => updateAccount(item)))
    if (!results.LastEvaluatedKey) break
    scanParams.ExclusiveStartKey = results.LastEvaluatedKey
}

const updateAccount = async (item) => {
    const deserializer = item.Type.S === 'User' ? userFromItem : organizationFromItem
    const entity = deserializer(item)
    return dynamodb.updateItem({
        TableName: process.env.TABLE_NAME,
        Key: entity.key(),
        UpdateExpression: 'SET #gsi1pk = :gsi1pk, #gsi1sk = :gsi1sk',
        ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK', '#gsi1sk': 'GSI1SK' },
        ExpressionAttributeValues: { ':gsi1pk': entity.gsi1pk(), ':gsi1sk': entity.gsi1sk() }
    }).promise()
}
```

Order of work for a migration, as the code base shows it:

| Step | Change |
|---|---|
| 1 | Add `gsiN()` methods to the entity and spread them in `toItem()` so new writes are indexed |
| 2 | Update every UpdateItem that changes inputs to the new keys (for example status) to also set them |
| 3 | Add the GSI and its IAM resource ARN to `serverless.yml`; deploy (one new GSI per deploy) |
| 4 | Run the back-fill script for existing items |
| 5 | Switch the read path to the new index and drop the filter expression it replaces |

The update is an idempotent `SET` computed from the item's own data, so the script can be re-run safely. Purely additive attributes need no script: `fromItem` supplies a default when the attribute is missing (`attributes.CodeOfConduct ? codeOfConductFromString(...) : {}`), and the attribute appears lazily on the next write. A filter on `Type` only narrows what the Scan returns; the Scan still reads, and bills for, the whole table. For big tables use parallel scan segments and add error handling.

---

## 12. IDs, timestamps, padding

| Need | Helper in the examples |
|---|---|
| Unique, time-sortable ID (orders, deals, messages, comments, gists) | KSUID built from the entity's `createdAt`: a 27-character string that sorts lexicographically by creation time |
| Opaque token (session) | `uuidv4()`; guarded with `attribute_not_exists(SessionId)` anyway |
| Sequential human-facing number (issues, PRs) | Atomic counter on the parent (section 5) |
| Natural keys (username, brand, repo) | Used directly, case-normalized inside key methods |

```js
const crypto = require('crypto')
const KSUID = require('ksuid')

const generateKSUID = timestamp => {
    const payload = crypto.randomBytes(16)
    return KSUID.fromParts(timestamp.getTime(), payload).string
}
```

The ID is generated in the entity constructor only when none was supplied, so the same class serves creation and rehydration. Putting a KSUID in the sort key gives chronological ordering without a separate timestamp key and guarantees uniqueness for items created at the same instant.

**Timestamps.** Stored as ISO 8601 strings via `toISOString()` (`CreatedAt`, `UpdatedAt`, `SentAt`), parsed back with `new Date(...)`. ISO strings sort correctly as text and are readable when debugging. They can sit directly in a sort key (`GSI3SK: #<updatedAt ISO>` for repos ordered by last update). TTL is the exception: epoch seconds as a Number.

**Time buckets in partition keys.** Truncate to the day and embed the result:

```js
const truncateTimestamp = timestamp => new Date(
    timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate()
)
// GSI1PK: `DEALS#${truncateTimestamp(createdAt).toISOString()}`
```

This truncates in the process's local time zone; writers and readers must agree, so run everything in UTC or build the bucket with UTC getters.

**Zero-padding numbers in sort keys.** Strings compare character by character, so `10` sorts before `9` unless padded to a fixed width. The stored application attribute stays unpadded.

```js
const zeroPadNumber = (number) => ("0000000" + number).slice(-7)            // 15 -> "0000015"
const zeroPadDifference = (number) => ("0000000" + (9999999 - number)).slice(-7)   // 15 -> "9999984"
```

`zeroPadDifference` reverses order: an ascending read over `ISSUE#OPEN#<difference>` returns the highest issue numbers first, which lets open items be read forward from the parent while closed items are read backward. The width fixes a ceiling (9,999,999 here); choose it for the lifetime of the data.

**Numbers on the wire.** With the low-level client, numbers go in as strings (`{ 'N': count.toString() }`) and come back as strings; entity constructors normalize with `parseInt`/`parseFloat`. Booleans are stored in the examples as the strings `'true'`/`'false'`.

---

## 13. Defects in the example code to avoid copying

The repos are teaching code. When adapting, keep the patterns and fix these:

| Where | Problem | Do instead |
|---|---|---|
| All pagination loops (`notify*Watchers`, `sendHotDealToAllUsers`, both migrations) | Cursor is assigned to `params.exclusiveStartKey` (lower-case `e`), which is not the API parameter | `params.ExclusiveStartKey = results.LastEvaluatedKey` |
| BatchWrite retry loops | `const count = 0` followed by `count++`; unprocessed items read from `result.UnprocessedItems.PutRequest`; the retry resends the whole batch | `UnprocessedItems` is keyed by table name; resend only those entries, with a mutable attempt counter |
| Session store expiry | `createdAt.setTime(createdAt.getDate() + EXPIRATION)` uses day-of-month and mutates `createdAt` | `new Date(createdAt.getTime() + EXPIRATION)` |
| Session store `getSession` | Does not reject sessions past expiry that TTL has not yet deleted | Compare `TTL`/`ExpiresAt` to now |
| Cancellation reason chains | Index into `error.cancellationReasons` without checking it was extracted | Guard for undefined |
| Some `fromItem` functions | Type mismatches between `toItem` and `fromItem` (for example an attribute written as `N` and read as `.S`; dates left as strings in `orderFromItem`) | Round-trip test every entity: `fromItem(entity.toItem())` equals the entity |
| E-commerce `createOrder` | README says it fails when the customer is missing, but the transaction has no check on the Customer item | Add a `ConditionCheck` with `attribute_exists(PK)` on `customer.key()` |
| Handlers | Nearly every error returns HTTP 500 | Map not-found and conflict errors to 404 and 409 |
| Stream handler | Catches and logs failures, so a failed batch is never retried | Let the error propagate if redelivery is wanted, and make the work idempotent |

---

## 14. Checklist

Implementing a finished model:

1. **Table:** generic `PK`/`SK`, one `GSI<n>PK`/`GSI<n>SK` pair per index, all strings; decide billing mode, projection per index, TTL attribute, stream view type. Add GSIs one deploy at a time on an existing stack.
2. **IAM:** only the actions used; table ARN plus each `index/<name>` ARN; `ConditionCheckItem` if any transaction uses a ConditionCheck; a stream statement for consumers.
3. **One entity class per row of the entity chart**, including marker, tracking, and singleton items: constructor with validation and defaults, `key()`, one method per index, `toItem()` with a `Type` attribute, `xFromItem()`.
4. **Keep application attributes separate from indexing attributes.** Never drop an attribute because a key encodes it; never read business data from a key; never reuse one attribute across two indexes.
5. **Key strings exist only in entity methods.** Data functions, stream handlers, and migrations call those methods.
6. **One data function per access pattern** from the model's access pattern list, named after it, returning entities or `{ error }`. Check the list is fully covered.
7. **Every create has `attribute_not_exists(PK)`; every update has `attribute_exists(PK)`.** A put without a condition is a deliberate overwrite.
8. **Multi-item invariants go in one transaction** (uniqueness markers, counters with tracking items, existence checks). Fix the order of `TransactItems` and map each index to a specific error message.
9. **Initialize counters and counter maps at creation** so `SET #c = #c + :inc` always has an operand.
10. **For each update, ask which index keys depend on the changed attributes,** and set or remove them in the same expression.
11. **For each Query, write down the collection's sort order,** then choose operator, `ScanIndexForward`, and `Limit` (plus 1 for the parent). Do not rely on position if the range can contain more than two entity types.
12. **Paginate every background Query/Scan** with `LastEvaluatedKey` -> `ExclusiveStartKey`; chunk BatchWriteItem at 25 and retry `UnprocessedItems`.
13. **Zero-pad every number that appears in a sort key;** use KSUIDs where items need unique, chronological IDs; ISO 8601 for timestamps; epoch seconds for TTL.
14. **Stream handlers filter on `eventName` and `Type`** before parsing with `fromItem`.
15. **Changing the model later:** add key methods to the entity, deploy the index, back-fill with a Type-filtered scan-and-update script, then switch the read path.
16. **Write a small script per access pattern** that calls the data function and prints the result, and round-trip test `toItem`/`fromItem` for every entity.
