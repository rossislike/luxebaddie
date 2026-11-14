# Worked Examples: Session Store and E-commerce Orders

Two complete, small data models taken end to end: requirements, ERD, access patterns, key design, operations, and the companion Node.js code. Read this when modeling a similar application (auth tokens with expiry, or customers with orders and line items) or when you want a template for how the modeling process turns into concrete keys and queries.

**Contents**

- [How the examples are worked](#how-the-examples-are-worked)
- [Example 1: Session store](#example-1-session-store)
  - [Requirements and ERD](#requirements-and-erd)
  - [Access patterns](#access-patterns)
  - [Final table design](#final-table-design)
  - [Key decisions and the strategy behind each](#key-decisions-and-the-strategy-behind-each)
  - [Access pattern table](#access-pattern-table)
  - [Code](#code)
  - [Book vs companion code](#book-vs-companion-code)
- [Example 2: E-commerce customers and orders](#example-2-e-commerce-customers-and-orders)
  - [Requirements and ERD](#requirements-and-erd-1)
  - [Access patterns](#access-patterns-1)
  - [Final entity chart](#final-entity-chart)
  - [Key decisions and the strategy behind each](#key-decisions-and-the-strategy-behind-each-1)
  - [Access pattern table](#access-pattern-table-1)
  - [Code](#code-1)
  - [Book vs companion code](#book-vs-companion-code-1)
- [Strategies to lift from these examples](#strategies-to-lift-from-these-examples)

---

## How the examples are worked

Both examples follow the same sequence. Reuse it.

1. Understand the application (screens, flows, constraints).
2. Draw the ERD. Entities and relationships only, no attributes: attributes describe the application, relationships drive the keys.
3. Start an **entity chart** (entity, PK, SK, one column pair per index) with the key columns empty, and list the access patterns. Simple single-item reads and writes can be left off the list unless something about them is interesting.
4. Ask three questions before designing keys:
   - Simple or composite primary key? Composite in all but the simplest models, because item collections plus Query are how you fetch many items at once.
   - Which requirements are unusual (uniqueness, expiry, "fetch parent and children", ordering)?
   - Which entity first? Start with a core entity, preferring the one with uniqueness requirements (those must live in the base table primary key) and the parent in parent-child relationships.
5. Fill in the entity chart one entity at a time, then write the access pattern table (pattern, index, parameters, notes).

Both the entity chart and the access pattern table belong in the repository docs so nobody has to reverse-engineer keys from the data access layer.

When sketching items, show only the **indexing attributes** (PK, SK, GSI keys). Application attributes exist on the real items but are noise during modeling.

---

## Example 1: Session store

### Requirements and ERD

- A user logs in with username and password. The backend creates a session token, stores it, and returns it.
- Later requests carry the token in the `Authorization` header. The backend looks the token up to identify the user.
- Tokens are invalidated two ways:
  - **Time-based:** a token expires 7 days after creation.
  - **Manual revocation:** a user or admin invalidates every outstanding token for a user (suspected compromise).

ERD: `User 1 --- N Session`. A user can hold several sessions at once (phone and laptop).

Only **Session** is modeled. Nothing about the user is stored or read here. The user is just a grouping value on sessions, so it does not get its own item type.

### Access patterns

1. Create Session
2. Get Session
3. Delete Session (time-based)
4. Delete Sessions for User (manual revocation)

### Final table design

| Element | Design |
|---|---|
| Primary key | Simple: partition key `SessionToken` (a UUID). No sort key. |
| GSI `UserIndex` | Simple key: partition key `Username`. Projection `KEYS_ONLY`. |
| TTL | Enabled on the attribute `TTL` (epoch seconds). |

| Entity | PK | SK | UserIndex PK |
|---|---|---|---|
| Session | `<SessionToken>` | none | `<Username>` |

Item attributes: `SessionToken`, `Username`, `CreatedAt` (ISO 8601), `ExpiresAt` (ISO 8601), `TTL` (epoch seconds number).

### Key decisions and the strategy behind each

| Decision | Reasoning | Strategy |
|---|---|---|
| Simple primary key | One entity type, and the core patterns (create, get) address exactly one item by token. Nothing needs an item collection in the base table. This is the only example in the book that uses a simple key. | Simple key for pure key-value access |
| Meaningful key names (`SessionToken`, `Username`) instead of `PK` / `SK` | The table holds one entity type, so there is nothing to overload. Generic names only pay off when several entity types share the key attributes. | Naming |
| Token is the partition key, written with `attribute_not_exists(SessionToken)` | Two users holding the same token would let one impersonate the other. A UUID makes collisions unlikely, but only the primary key plus a condition makes them impossible. Uniqueness in DynamoDB must be built into the primary key. | Uniqueness via primary key + condition expression |
| TTL attribute for the 7-day expiry | Three options were weighed: (1) proactive expiry with an extra index on expiry time and a background job that scans and deletes, which costs an index and a job to operate; (2) lazy expiry, checking on read and deleting then, which is simpler but leaves tokens of users who never return in the table forever; (3) DynamoDB TTL, which deletes for you. TTL wins on maintenance. | TTL |
| Keep `ExpiresAt` as ISO 8601 and add a separate `TTL` in epoch seconds | TTL requires an epoch timestamp. ISO 8601 stays for humans and sortability. Duplicating the value is cheaper than giving up readability. | Duplicate an attribute in the format each consumer needs |
| Check expiry on read as well | TTL deletion is asynchronous: DynamoDB only promises removal within roughly 48 hours of expiry. Without a read-time check, an expired token can still authenticate. | Filter expression (or app-side check) on top of TTL |
| GSI on `Username` for revocation | There is no "DELETE WHERE". Deletes need full primary keys, and the base table cannot be queried by user. The GSI groups a user's sessions so their tokens can be found and then deleted one by one. | Secondary index to regroup items, then two-step find-and-delete |
| `KEYS_ONLY` projection | The revocation flow needs only the token (the base table key), which every index carries automatically. Smaller index, cheaper writes. | Minimal projection |

Note on "sparse index": `UserIndex` is not sparse. Every session has a `Username`, so every item appears in the index. It is a plain regrouping GSI.

### Access pattern table

| Access pattern | Index | Operation | Key condition / parameters | Notes |
|---|---|---|---|---|
| Create Session | Main table | `PutItem` | `SessionToken` = new UUID | `ConditionExpression: attribute_not_exists(SessionToken)`. Write `TTL` = expiry in epoch seconds. |
| Get Session | Main table | `Query` (book) or `GetItem` + app check | `SessionToken = :token` | Exclude expired tokens: keep the item only if `TTL > now`. |
| Delete Session (time-based) | n/a | none | n/a | DynamoDB TTL removes the item. |
| Delete Sessions for User | `UserIndex`, then main table | `Query`, then `DeleteItem` per token (book) or `BatchWriteItem` (code) | `Username = :username`, then `SessionToken` of each result | Two steps: find tokens, delete each. |

### Code

Table definition (CloudFormation inside `serverless.yml`, shown with the book's attribute name):

```yaml
SessionStoreTable:
  Type: AWS::DynamoDB::Table
  Properties:
    AttributeDefinitions:
      - { AttributeName: "SessionToken", AttributeType: "S" }
      - { AttributeName: "Username",     AttributeType: "S" }
    KeySchema:
      - { AttributeName: "SessionToken", KeyType: "HASH" }
    BillingMode: "PAY_PER_REQUEST"
    GlobalSecondaryIndexes:
      - IndexName: "UserIndex"
        KeySchema:
          - { AttributeName: "Username", KeyType: "HASH" }
        Projection: { ProjectionType: "KEYS_ONLY" }
    TimeToLiveSpecification: { AttributeName: "TTL", Enabled: true }
```

The Lambda role needs the index ARN (`<tableArn>/index/UserIndex`) as a resource in addition to the table ARN, otherwise the index Query is denied.

Create (adapted from `data/index.js`, with the expiry arithmetic corrected, see the differences below):

```js
const EXPIRATION_MS = 7 * 86400000

const createSession = async ({ username, createdAt = new Date() }) => {
  const sessionToken = uuidv4()
  const expiresAt = new Date(createdAt.getTime() + EXPIRATION_MS)
  await dynamodb.putItem({
    TableName: process.env.TABLE_NAME,
    Item: {
      SessionToken: { S: sessionToken },
      Username:     { S: username },
      CreatedAt:    { S: createdAt.toISOString() },
      ExpiresAt:    { S: expiresAt.toISOString() },
      TTL:          { N: Math.floor(expiresAt.getTime() / 1000).toString() }
    },
    ConditionExpression: 'attribute_not_exists(SessionToken)'
  }).promise()
  return { sessionToken }
}
```

A `ConditionalCheckFailedException` here means a token collision. Generate a new token and retry rather than surfacing an error.

Get with expiry enforced (the book's approach, with the comparison written so that live tokens are kept):

```js
const resp = await dynamodb.query({
  TableName: process.env.TABLE_NAME,
  KeyConditionExpression: '#token = :token',
  FilterExpression: '#ttl > :now',
  ExpressionAttributeNames: { '#token': 'SessionToken', '#ttl': 'TTL' },
  ExpressionAttributeValues: {
    ':token': { S: sessionToken },
    ':now':   { N: Math.floor(Date.now() / 1000).toString() }
  }
}).promise()
// resp.Items is empty if the token is unknown or expired
```

Query is used instead of GetItem because GetItem has no filter expression. `GetItem` followed by an application-side comparison of `TTL` is equivalent.

Revoke all sessions for a user (from `data/index.js`):

```js
const response = await dynamodb.query({
  TableName: process.env.TABLE_NAME,
  IndexName: process.env.INDEX_NAME,            // UserIndex
  KeyConditionExpression: '#username = :username',
  ExpressionAttributeNames: { '#username': 'Username' },
  ExpressionAttributeValues: { ':username': { S: username } }
}).promise()

const deletes = response.Items.map((item) => ({
  DeleteRequest: { Key: { SessionToken: item.SessionToken } }
}))
await dynamodb.batchWriteItem({
  RequestItems: { [process.env.TABLE_NAME]: deletes }
}).promise()
```

The handler first resolves the caller's own bearer token and refuses the request unless that session's username matches the username in the path, so one user cannot revoke another's sessions.

### Book vs companion code

| Topic | Book text | Companion code (`session-store-node`) | What to do |
|---|---|---|---|
| Key attribute name | `SessionToken` | `SessionId` | Either. Be consistent across table definition, condition expression, and delete keys. |
| Expiry check on read | `Query` with a filter expression on `TTL` | Plain `GetItem`, no expiry check at all | Keep a read-time check. The code as shipped accepts expired tokens until TTL deletes them. |
| Filter comparison | Sample shows `#ttl <= :epoch` while the prose says expired items should be dropped | n/a | A filter keeps items that match, so `<=` would return only expired tokens. Use `#ttl > :now`. |
| Expiry arithmetic | `created_at + 7 days` | `createdAt.setTime(createdAt.getDate() + EXPIRATION)`: `getDate()` is the day of the month, so the result lands in January 1970, and `setTime` mutates `createdAt` so both timestamps are wrong | Use `getTime()` and do not mutate. Also floor the TTL to whole seconds. |
| Deleting a user's tokens | Loop of `DeleteItem` calls | One `BatchWriteItem` | Batch is fewer round trips, but the code does not chunk to 25 requests per call, retry `UnprocessedItems`, or paginate the Query. Add all three for real use. |
| Password check | Backend verifies credentials before issuing a token | Stubbed with a comment | Out of scope for the data model. |

Also relevant to revocation: the GSI is eventually consistent, so a session created an instant before revocation might not appear in the index query. (General GSI behavior, not called out in this chapter.)

---

## Example 2: E-commerce customers and orders

### Requirements and ERD

Scope is customer management and order management only. Inventory, pricing, and cart live in another service.

Screens to serve:

- **Account overview:** customer info plus a paginated list of the most recent orders. Each order shows summary data only (date, order number, status, item count, total), not line items. Order status changes over time.
- **Order detail:** the order summary plus every item in the order, with payment and shipping information.
- **Addresses:** a customer saves multiple named addresses ("Home", "Parents' House").

Extra rule: a customer is identified by username and must also supply an email. **Both must be unique** across customers.

ERD:

```
Customer 1 --- N Address
Customer 1 --- N Order
Order    1 --- N OrderItem
```

### Access patterns

1. Create Customer (unique on username and on email)
2. Create / Update / Delete Mailing Address for Customer
3. Place Order
4. Update Order (status)
5. View Customer and Most Recent Orders for Customer
6. View Order and Order Items

### Final entity chart

Table: composite primary key `PK` / `SK`, one global secondary index `GSI1` with `GSI1PK` / `GSI1SK`, projection `ALL`. Generic key names because several entity types share them (primary key overloading).

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Customer | `CUSTOMER#<Username>` | `CUSTOMER#<Username>` | | |
| CustomerEmail | `CUSTOMEREMAIL#<Email>` | `CUSTOMEREMAIL#<Email>` | | |
| Address | n/a (map attribute on Customer) | n/a | | |
| Order | `CUSTOMER#<Username>` | `#ORDER#<OrderId>` | `ORDER#<OrderId>` | `ORDER#<OrderId>` |
| OrderItem | `ORDER#<OrderId>#ITEM#<ItemId>` | `ORDER#<OrderId>#ITEM#<ItemId>` | `ORDER#<OrderId>` | `ITEM#<ItemId>` |

`<OrderId>` is a KSUID: unique, and it sorts by creation time because it starts with a timestamp.

The chart diverges from the ERD in two places, and both are typical: an extra item type exists only to enforce a constraint (CustomerEmail), and an ERD entity has no item of its own because it was denormalized (Address).

Resulting item collections:

```
Base table, partition CUSTOMER#alexdebrie (ascending SK)
  #ORDER#<older KSUID>     Order
  #ORDER#<newer KSUID>     Order
  CUSTOMER#alexdebrie      Customer      <- last, so a reverse read returns it first

GSI1, partition ORDER#<OrderId> (ascending GSI1SK)
  ITEM#<ItemId>            OrderItem
  ITEM#<ItemId>            OrderItem
  ORDER#<OrderId>          Order         <- last ("O" sorts after "I")
```

### Key decisions and the strategy behind each

**Composite primary key.** More than a couple of entities and several "fetch many" patterns both point to a composite key.

**Start with Customer.** It carries the uniqueness requirements, which must be solved in the base table primary key, and it is the parent of Orders.

**Username and email uniqueness: two items in one transaction.**
- Uniqueness cannot be enforced through a secondary index, only through the base table primary key.
- Putting both values in one item's key would only make the *combination* unique. Each unique value needs its own item.
- So: a Customer item keyed by username (holds all customer data, used for lookups) and a CustomerEmail tracking item keyed by email (holds just enough to say who owns the email, never read by the application's main flows).
- Both are written in a single `TransactWriteItems`, each with `attribute_not_exists(PK)`. If either value is taken the whole write is cancelled.
- Strategy: uniqueness on multiple attributes via a transaction with a tracking item.
- Consequence: any later change of email (or deletion of a customer) must also be a transaction that removes or swaps the tracking item.

**Addresses: complex attribute on the Customer item.** Two questions decide whether a one-to-many relationship can be denormalized into a parent attribute:
1. Is the related entity ever fetched directly by its own values, outside the parent? No. Addresses are only shown inside the customer's account or checkout. There is no "find customer by address".
2. Is the data unbounded? Not if the product caps saved addresses at, say, 20. This limit was not in the original requirements. Adding a harmless product constraint to simplify the model is a legitimate move.

Both answers are "no", so `Addresses` is a map on the Customer item, keyed by address name. Strategy: denormalization with a complex attribute.

**Orders: same partition as the Customer, pre-joined.**
- Denormalizing is out: orders per customer are unbounded and items cap at 400KB.
- There is a join-like read (customer plus recent orders in one request). Query only reads one partition, so Orders get `PK = CUSTOMER#<Username>`.
- `SK = #ORDER#<KSUID>` gives chronological order within the partition.
- The leading `#` on the Order sort key is deliberate. The read wants the *most recent* orders, so it scans in descending order, and the Customer item must sit at the end of the collection to come back first, followed by the newest orders. `#` sorts before letters, so every `#ORDER#...` sorts before `CUSTOMER#...`. Without the prefix, `ORDER#...` would sort after `CUSTOMER#...` and a descending read would return every order before reaching the customer.
- Strategy: one-to-many via primary key + Query, with the parent positioned by sort key prefix for the scan direction you need.

**OrderItems: their own partition in the base table, joined to the Order in GSI1.**
- Denormalizing onto the Order is out (unbounded items per order).
- Putting OrderItems in the customer partition under each order would interleave them between Orders, so the "customer and recent orders" query would drag back line items it does not show. Protect the hot pattern.
- Instead each OrderItem gets a standalone base key (`ORDER#<OrderId>#ITEM#<ItemId>` for both PK and SK), and both Order and OrderItems get `GSI1PK = ORDER#<OrderId>`. In GSI1 they form one item collection, so one Query returns the order and all its items.
- Strategy: one-to-many via secondary index + Query. Same pre-join idea as before, relocated to an index because the base table collection is already spoken for.

### Access pattern table

| Access pattern | Index | Operation | Key / key condition | Notes |
|---|---|---|---|---|
| Create Customer | Main table | `TransactWriteItems`: Put Customer + Put CustomerEmail | `CUSTOMER#<Username>` and `CUSTOMEREMAIL#<Email>` | `attribute_not_exists(PK)` on both puts. |
| Create / Update Address | Main table | `UpdateItem` on Customer | `PK = SK = CUSTOMER#<Username>` | `SET #addresses.#name = :address`, condition `attribute_exists(PK)`. |
| Delete Address | Main table | `UpdateItem` on Customer | same | `REMOVE #addresses.#name`, condition `attribute_exists(PK)`. |
| View Customer and Most Recent Orders | Main table | `Query` | `PK = CUSTOMER#<Username>` | `ScanIndexForward=false`, `Limit=11` (customer + 10 orders). Page with `LastEvaluatedKey`. |
| Place Order | Main table | `TransactWriteItems`: Put Order + Put each OrderItem | Order: `CUSTOMER#<Username>` / `#ORDER#<OrderId>`; items: `ORDER#<OrderId>#ITEM#<ItemId>` | All-or-nothing, so an order never exists without its items. |
| Update Order | Main table | `UpdateItem` on Order | `PK = CUSTOMER#<Username>`, `SK = #ORDER#<OrderId>` | `SET #status = :status`. Needs both username and order id. |
| View Order and Order Items | GSI1 | `Query` | `GSI1PK = ORDER#<OrderId>` | Order and items arrive together. Split them in application code. |
| Get Customer (code only) | Main table | `GetItem` | `PK = SK = CUSTOMER#<Username>` | Includes all saved addresses. |

### Code

Layout of `e-commerce-node`, a good shape to copy:

- `entities/`: one class per entity. `key()` returns the primary key, `gsi1()` the index keys, `toItem()` the full DynamoDB item, and an `xFromItem()` function parses an item back into an object. All key-string formatting lives here and nowhere else.
- `data/`: one module per access pattern. Each performs the DynamoDB calls and returns objects or an error.
- `handlers/`: Lambda handlers that validate input, build an entity, and call one `data` function.

Table definition (`serverless.yml`):

```yaml
EcommerceTable:
  Type: AWS::DynamoDB::Table
  Properties:
    AttributeDefinitions:
      - { AttributeName: "PK",     AttributeType: "S" }
      - { AttributeName: "SK",     AttributeType: "S" }
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
        Projection: { ProjectionType: ALL }
```

Key helpers (condensed from `entities/customers.js` and `entities/orders.js`):

```js
class Customer {
  key() {
    return { PK: { S: `CUSTOMER#${this.username}` }, SK: { S: `CUSTOMER#${this.username}` } }
  }
  toItem() {
    return { ...this.key(), Type: { S: 'Customer' }, Username: { S: this.username },
      Email: { S: this.email }, Name: { S: this.name },
      Addresses: { M: this.formatAddresses() } }   // {} for a new customer
  }
}

class CustomerEmail {
  key() {
    return { PK: { S: `CUSTOMEREMAIL#${this.email}` }, SK: { S: `CUSTOMEREMAIL#${this.email}` } }
  }
  toItem() {
    return { ...this.key(), Type: { S: 'CustomerEmail' }, Email: { S: this.email }, Username: { S: this.username } }
  }
}

// KSUID with the order's creation time embedded, so ids sort chronologically
const generateOrderId = createdAt => KSUID.fromParts(createdAt.getTime(), crypto.randomBytes(16)).string

class Order {
  key()  { return { PK: { S: `CUSTOMER#${this.username}` }, SK: { S: `#ORDER#${this.orderId}` } } }
  gsi1() { return { GSI1PK: { S: `ORDER#${this.orderId}` }, GSI1SK: { S: `ORDER#${this.orderId}` } } }
}

class OrderItem {
  key() {
    const k = `ORDER#${this.orderId}#ITEM#${this.itemId}`
    return { PK: { S: k }, SK: { S: k } }
  }
  gsi1() { return { GSI1PK: { S: `ORDER#${this.orderId}` }, GSI1SK: { S: `ITEM#${this.itemId}` } } }
}
```

Every item also carries a `Type` attribute. The Order item stores summary fields (`Status`, `TotalAmount`, `NumberItems`, `CreatedAt`) and a copy of the shipping address, so the account overview never needs the line items and the order keeps the address it shipped to even if the customer later edits or deletes the saved one.

Create customer with two uniqueness guarantees (`data/createCustomer.js`):

```js
const params = {
  TransactItems: [
    { Put: { Item: customer.toItem(),      TableName, ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { Item: customerEmail.toItem(), TableName, ConditionExpression: 'attribute_not_exists(PK)' } }
  ]
}
try {
  await executeTransactWrite({ client: dynamodb, params })
} catch (error) {
  if (error.code === 'TransactionCanceledException') {
    // cancellationReasons is index-aligned with TransactItems
    if (error.cancellationReasons[0].Code === 'ConditionalCheckFailed') return { error: 'Customer with this username already exists.' }
    if (error.cancellationReasons[1].Code === 'ConditionalCheckFailed') return { error: 'Customer with this email already exists.' }
  }
}
```

`executeTransactWrite` (`data/utils.js`) exists because AWS SDK v2 does not expose the per-item cancellation reasons on the error. It hooks the request's `extractError` event and parses `CancellationReasons` out of the raw response body. Reading the reasons by position is what lets the API say *which* uniqueness rule failed. (Not from the book: SDK v3 exposes `CancellationReasons` on `TransactionCanceledException` directly.)

Create order and its items atomically (`data/createOrder.js`):

```js
const transactItems = [{
  Put: { Item: order.toItem(), TableName, ConditionExpression: 'attribute_not_exists(PK)' }
}]
order.items.forEach((item) => {
  transactItems.push({ Put: { Item: item.toItem(), TableName } })
})
await executeTransactWrite({ client: dynamodb, params: { TransactItems: transactItems } })
```

Address edits on the complex attribute (`data/editAddressForCustomer.js`, `data/deleteAddressForCustomer.js`):

```js
await dynamodb.updateItem({
  TableName,
  Key: customer.key(),
  ConditionExpression: 'attribute_exists(PK)',            // do not create a customer by accident
  UpdateExpression: 'SET #addresses.#name = :address',    // delete: 'REMOVE #addresses.#name'
  ExpressionAttributeNames: { '#addresses': 'Addresses', '#name': name },
  ExpressionAttributeValues: { ':address': address.toMap() },
  ReturnValues: 'ALL_NEW'
}).promise()
```

This touches one map entry without reading or rewriting the others. It only works because the Customer is created with an empty `Addresses` map: a `SET` on a nested path fails if the parent map does not exist.

Fetch parent with children, base table (`data/getOrdersForCustomer.js`, with the book's limit added):

```js
const resp = await dynamodb.query({
  TableName,
  KeyConditionExpression: '#pk = :pk',
  ExpressionAttributeNames: { '#pk': 'PK' },
  ExpressionAttributeValues: { ':pk': customer.key()['PK'] },
  ScanIndexForward: false,
  Limit: 11
}).promise()
const customerItem = resp.Items.shift()                 // Customer sorts last, so it is first in reverse
const orders = resp.Items.map((item) => orderFromItem(item))
```

Fetch parent with children, index (`data/getOrder.js`):

```js
const resp = await dynamodb.query({
  TableName,
  IndexName: 'GSI1',
  KeyConditionExpression: '#gsi1pk = :gsi1pk',
  ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK' },
  ExpressionAttributeValues: { ':gsi1pk': order.gsi1()['GSI1PK'] },
  ScanIndexForward: false
}).promise()
const orderItem = resp.Items.shift()                    // ORDER#... sorts after ITEM#..., first in reverse
const order = orderFromItem(orderItem)
order.items = resp.Items.map((item) => orderItemFromItem(item))
```

Both readers rely on sort position to tell the parent from the children. Branching on the `Type` attribute instead is more robust, particularly once results are paginated and the parent only appears on the first page.

Update order status (`data/updateStatusForOrder.js`): `UpdateItem` with `Key: order.key()`, `ConditionExpression: 'attribute_exists(PK)'`, `UpdateExpression: 'SET #status = :status'`. `Status` is aliased through `ExpressionAttributeNames`. The entity constructor validates the value against `PLACED`, `PICKED`, `SHIPPED`, `DELIVERED`, `CANCELLED`.

### Book vs companion code

| Topic | Book text | Companion code (`e-commerce-node`) | What to do |
|---|---|---|---|
| Customer + recent orders | `Limit=11`, described as a paginated list | No `Limit`, no pagination: returns one Query page (up to 1MB) of all orders | Set a limit and page with `LastEvaluatedKey`. |
| Order + items query direction | Default ascending (items first, order last) | `ScanIndexForward: false` so the Order comes first and can be shifted off | Either works. Prefer identifying items by `Type`. |
| OrderItem `GSI1SK` | `ITEM#<ItemId>` | Code writes `ITEM#<ItemId>`; the repo README chart says `Item#<ItemId>` | The README is a typo. Case matters for sort order. |
| Place Order validation | Transaction creates Order and OrderItems | Same, with `attribute_not_exists(PK)` on the Order only. The README says it fails for an unknown customer, but nothing checks that the Customer item exists | Add a `ConditionCheck` on `CUSTOMER#<Username>` with `attribute_exists(PK)` if orders for unknown customers must be rejected. |
| Transaction size | Earlier chapters give 10 items per transaction | No cap on items per order in the handler (`minItems: 1` only) | One slot goes to the Order, so order size is bounded by the transaction limit. (Not from the book: the current service limit is 100 actions per transaction.) Larger orders need a different write strategy. |
| Address limit | Cap of about 20 addresses is what justifies the complex attribute | Not enforced anywhere | Enforce it on write, or the "bounded" assumption is fiction. |
| CustomerEmail attributes | Table sketch shows keys; prose says a few identifying attributes | Stores `Email`, `Username`, `Type` | Storing the owner's username is useful for support and for cleanup. |
| Access patterns | Six | Adds a standalone Get Customer (`GetItem`) and a separate Delete Address endpoint | Fine. Single-item reads were simply left off the book's list. |
| Order totals | Not specified | `TotalAmount` sums `price` and ignores `amount`, while each OrderItem's `TotalCost` is `price * amount` | Looks like a bug in the sample. Do not copy the arithmetic. |
| Authorization | Not discussed | None. `getOrder` takes a username in the path but queries by order id alone | The README flags this as out of scope. Verify ownership in real code (compare the Order's `Username`). |

---

## Strategies to lift from these examples

| Situation | Strategy shown | Where |
|---|---|---|
| One entity, lookups by a single id | Simple primary key with a meaningful attribute name | Session store |
| A value must never be duplicated | Make it the primary key and write with `attribute_not_exists` | Session token, Customer username |
| Two independent unique attributes on one entity | One tracking item per extra attribute, written with the main item in a transaction, each put conditioned | Customer + CustomerEmail |
| Items expire after a fixed lifetime | TTL attribute in epoch seconds, plus a read-time check because deletion lags | Session expiry |
| "Delete everything for X" where X is not in the key | Index on X (keys-only projection), Query it, then delete by primary key | Revoke sessions by username |
| Small, bounded child list only ever read with its parent | Map attribute on the parent, edited per entry with `SET map.key` / `REMOVE map.key` | Addresses |
| Unbounded children fetched together with the parent | Same partition key as the parent, sort key prefix chosen so the parent lands at the correct end for the scan direction | Customer + Orders |
| Newest-first child listing | Time-sortable id (KSUID) in the sort key, `ScanIndexForward=false`, `Limit` | Recent orders |
| A second parent-child level that would pollute the first collection | Give the grandchildren their own base keys and co-locate them with their parent in a GSI | Order + OrderItems in GSI1 |
| Parent and children must be created together | `TransactWriteItems` with all puts | Place Order |
| List view needs child aggregates but not the children | Store summary fields (count, total, status) on the parent | Order summary on account overview |
