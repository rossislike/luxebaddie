# Migrations and Additional Strategies

How to evolve a DynamoDB data model when access patterns change (what is free, what needs a scan-and-update job, and what that job looks like), plus five building-block strategies: multi-attribute uniqueness, sequential IDs, pagination, singleton items, and reference counts. Read this when adding an entity or access pattern to an existing table, or when a design needs one of those building blocks.

## Contents

- [Migrations: the one question](#migrations-the-one-question)
- [Migration scenario table](#migration-scenario-table)
- [Scenario details](#scenario-details)
- [The ETL scan-and-update script](#the-etl-scan-and-update-script)
- [Parallel scans](#parallel-scans)
- [Uniqueness on two or more attributes](#uniqueness-on-two-or-more-attributes)
- [Sequential IDs](#sequential-ids)
- [Pagination](#pagination)
- [Singleton items](#singleton-items)
- [Reference counts](#reference-counts)
- [Strategy summary](#strategy-summary)

---

## Migrations: the one question

For any model change, ask: **is it purely additive, or must existing items be edited?**

- **Purely additive:** new attributes or new items can be written from now on without touching what is already stored. Ship application code and move on.
- **Not additive:** existing items need new **indexing attributes** (for example `GSI1PK` / `GSI1SK`) so they land in a new item collection. That requires a batch job that scans the table and decorates the matching items.

Only indexing attributes count for this test. Application attributes (birthdate, fax number, a nested map) never force a backfill because DynamoDB is schemaless and the application can default missing values on read.

A quick way to classify: write down the new access pattern's target item collection (table or index, PK, SK). If every existing item that must appear in it already has those key attributes with the right values, the change is additive. If not, backfill.

---

## Migration scenario table

| Scenario | Additive? | What to do | Example |
|---|---|---|---|
| New attribute on an existing entity | Yes | Write it going forward; default it when deserializing old items | Birthdate on User; code of conduct on a repo |
| New entity, no relational access pattern with existing entities | Yes | Write the new items into their own new item collection | Projects under an Organization, fetched without the Organization |
| New entity into an **existing** item collection | Yes | Give the new items the parent's existing partition key and a sort key that places them correctly | Likes in the Post's base-table collection |
| New entity into a **new** item collection | No | Create a GSI collection; new items carry the GSI keys from day one; **backfill GSI keys onto existing parents** | Comments + Post in GSI1 |
| Joining existing items into a new item collection (new filter, new sort, or new join over existing types) | No | Design the collection in a new or existing index; **backfill index keys onto all participating existing items** | Issues and Pull Requests regrouped under their Repo in new indexes |

"Relational access pattern" means "fetch the parent and its related items in one request". A new entity can have a one-to-many relationship on the ERD and still be additive, as long as no access pattern needs the parent in the same Query.

---

## Scenario details

### New attribute on an existing entity

Handle absence at the boundary where DynamoDB items become application objects.

```js
const userFromItem = (item) => new User({
  username: item.Username.S,
  name: item.Name.S,
  birthdate: item.Birthdate ? item.Birthdate.S : undefined   // old items lack it
})
```

- Works for denormalized one-to-many relationships too (a list or map attribute on the parent): add it lazily as items are next written.
- If the new attribute must be queryable (part of an index key), it is no longer this scenario; treat it as "joining existing items into a new item collection".

### New entity without relations

Starting table: Organizations and Users under `PK = ORG#<OrgName>`. New entity: Project, with "get Projects for Organization" but no need to return the Organization itself.

| Entity | PK | SK |
|---|---|---|
| Organization | `ORG#<OrgName>` | `ORG#<OrgName>` |
| User | `ORG#<OrgName>` | `USER#<UserName>` |
| Project (new) | `PROJECTS#<OrgName>` | `PROJECT#<ProjectName>` |

The Project key pattern is illustrative (the book's figure is not available); the point is that Projects share a partition with each other and with no existing item. No existing item changes.

### New entity into an existing item collection

Use when the parent's item collection is not already consumed by another relationship (or has a free side, see "two relational access patterns in one item collection" in the sorting reference).

| Entity | PK | SK |
|---|---|---|
| Post (existing) | `POST#<PostId>` | `POST#<PostId>` |
| Like (new) | `POST#<PostId>` | `LIKE#<Username>` |

"Fetch Post and its Likes" is now a Query on `PK = POST#<PostId>`. Existing Post items are untouched. Check where the new sort key prefix lands relative to the parent before committing: `LIKE#` sorts before `POST#`, so the Post is the last item in the collection and a backward read returns it first.

### New entity into a new item collection

Use when the parent's base-table collection is already taken. Continuing the example, Comments arrive with "fetch Post and its most recent Comments", but the Post collection already holds Likes.

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Post (existing, backfilled) | `POST#<PostId>` | `POST#<PostId>` | `POST#<PostId>` | `POST#<PostId>` |
| Comment (new) | `COMMENT#<CommentId>` | `COMMENT#<CommentId>` | `POST#<PostId>` | `COMMENT#<Timestamp>` |
| Like | `POST#<PostId>` | `LIKE#<Username>` | (none) | (none) |

Rollout order:
1. Create GSI1 if it does not exist.
2. Deploy code that writes `GSI1PK`/`GSI1SK` on every **new** Post and Comment.
3. Run the ETL job to add `GSI1PK`/`GSI1SK` to every **existing** Post.
4. Turn on the read path that queries GSI1.

Doing step 2 before step 3 closes the gap where Posts created during the scan would be missed. (The ordering is an operational inference; the book describes the model change and the script.)

In this layout `COMMENT#` sorts before `POST#` in GSI1, so "Post + most recent Comments" is a backward read from the end of the partition: `GSI1PK = POST#<PostId>`, `ScanIndexForward: false`, `Limit: n + 1`.

### Joining existing items into a new item collection

No new entity, only a new access pattern over existing ones: a different filter, a different sort, or a join between types that used to live apart. Same procedure as the previous scenario, except the backfill may touch several entity types:

1. Design the item collection in a new or existing secondary index.
2. Identify every existing item that must appear in it.
3. Backfill the index key attributes onto those items.

The GitHub migration example does this in one scan: Repos get `GSI4PK/GSI4SK` and `GSI5PK/GSI5SK`, Issues get `GSI4PK/GSI4SK`, Pull Requests get `GSI5PK/GSI5SK`.

---

## The ETL scan-and-update script

Every non-additive migration reduces to two parameters:

- **Which items do I want?** Usually a filter on the `Type` attribute. This is why every item should carry a `Type` attribute.
- **Which attributes do I add to each?** Usually computed from the item's existing attributes by the same entity code the application uses.

Shape, adapted from the migration example:

```js
const migratePosts = async () => {
  const scanParams = {
    TableName: process.env.TABLE_NAME,
    FilterExpression: '#type = :type',
    ExpressionAttributeNames: { '#type': 'Type' },
    ExpressionAttributeValues: { ':type': { S: 'Post' } }
  }
  while (true) {
    // 1. Scan a page
    const results = await dynamodb.scan(scanParams).promise()

    // 2. Decorate each matching item with its new indexing attributes
    await Promise.all((results.Items || []).map((item) =>
      dynamodb.updateItem({
        TableName: process.env.TABLE_NAME,
        Key: { PK: item.PK, SK: item.SK },
        UpdateExpression: 'SET #gsi1pk = :gsi1pk, #gsi1sk = :gsi1sk',
        ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK', '#gsi1sk': 'GSI1SK' },
        ExpressionAttributeValues: { ':gsi1pk': item.PK, ':gsi1sk': item.SK }
      }).promise()
    ))

    // 3. Continue until the scan reports no more pages
    if (!results.LastEvaluatedKey) break
    scanParams.ExclusiveStartKey = results.LastEvaluatedKey
  }
}
```

Notes and gotchas:
- The filter expression only trims what comes back. The Scan still reads, and bills for, every item in the table. That is expected for a one-off migration.
- Use `UpdateItem` with `SET`, not `PutItem`, so concurrent application writes to other attributes are not overwritten. The update is idempotent, so the job can be rerun safely after a failure.
- `ExclusiveStartKey` is case-sensitive. The companion migration scripts assign `scanParams.exclusiveStartKey` (lowercase), which the SDK does not treat as the pagination parameter; do not copy that spelling.
- A page may contain zero matching items and still have a `LastEvaluatedKey`. Loop on the key, never on item count.
- Hardening the book calls for: parallel scans, error handling and retries, and batching writes. Not from the book: `BatchWriteItem` only does whole-item puts and deletes, so it cannot express "add two attributes"; batching here means concurrent `UpdateItem` calls (as above) or re-putting full items, which risks clobbering concurrent writes.
- Not from the book: throttle or rate-limit the job against provisioned capacity (table and the GSI being populated), and add a condition such as `attribute_exists(PK)` so an item deleted mid-scan is not resurrected as a stub by the update.
- Test the job thoroughly against a copy or a non-production table and monitor it while it runs. This is the riskiest part of any migration, but the logic is small.

---

## Parallel scans

Speed up the ETL scan by splitting the table into segments, one worker per segment. DynamoDB handles the partitioning; workers share no state.

| Parameter | Meaning |
|---|---|
| `TotalSegments` | Number of segments to split the scan into. Same value for every worker |
| `Segment` | Zero-based index of the segment this worker scans (`0` to `TotalSegments - 1`) |

```js
const scanParams = {
  TableName: 'SocialNetwork',
  FilterExpression: '#type = :type',
  ExpressionAttributeNames: { '#type': 'Type' },
  ExpressionAttributeValues: { ':type': { S: 'Post' } },
  TotalSegments: 10,
  Segment: 0          // workers 1-9 use Segment 1-9
}
```

Each worker runs the same paginate-and-update loop with its own `LastEvaluatedKey`. Together the segments cover every item exactly once.

---

## Uniqueness on two or more attributes

**Rule:** uniqueness in DynamoDB exists only on the full primary key. To make an attribute unique, build it into a primary key and write with `attribute_not_exists`.

**Trap:** putting both attributes in one key, for example `PK = USER#<Username>`, `SK = <Email>`. That enforces uniqueness of the *combination* only. Two people can now register the same username with different emails, so you have lost the original guarantee without gaining the new one.

**Pattern:** one item per unique attribute, written in a single transaction, each with its own "must not exist" condition.

| Item | PK | SK | Attributes |
|---|---|---|---|
| User | `USER#<Username>` | `USER#<Username>` | Full user data |
| UserEmail (tracking item) | `USEREMAIL#<Email>` | `USEREMAIL#<Email>` | None required (optionally `Username` as a pointer) |

```js
{
  TransactItems: [
    { Put: {
        TableName: 'UsersTable',
        Item: { PK: { S: 'USER#alexdebrie' }, SK: { S: 'USER#alexdebrie' },
                Username: { S: 'alexdebrie' }, FirstName: { S: 'Alex' } /* ... */ },
        ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: {
        TableName: 'UsersTable',
        Item: { PK: { S: 'USEREMAIL#alex@debrie.com' }, SK: { S: 'USEREMAIL#alex@debrie.com' } },
        ConditionExpression: 'attribute_not_exists(PK)' } }
  ]
}
```

- If either condition fails, the whole transaction is cancelled and nothing is written. Inspect the per-operation cancellation reasons to tell the caller which attribute was taken.
- Keep the tracking item as a bare marker if users are only ever fetched by username.
- If users must also be fetched by email, the alternative is duplicating the full user data onto the email item. Avoid it where possible: every later user update must then be a transaction across both items, raising write cost and latency.
- Implied by the pattern (not spelled out in the book): changing or deleting the unique attribute must also be a transaction that removes the old tracking item and, for a change, creates the new one with `attribute_not_exists`. Normalize values such as email case before building the key.

---

## Sequential IDs

DynamoDB has no auto-increment. Prefer meaningful or random identifiers (username, KSUID). Use sequential numbers only when users need them: issue numbers, ticket numbers, order numbers.

**Pattern:** keep a counter attribute on the parent item; increment it and read back the new value; use that value in the child's key.

| Item | PK | SK | Attributes |
|---|---|---|---|
| Project | `PROJECT#<ProjectId>` | `PROJECT#<ProjectId>` | `IssueCount` (number) |
| Issue | `PROJECT#<ProjectId>` | `ISSUE#<IssueNumber>` | ... |

```js
// Step 1: atomically claim the next number
const resp = await dynamodb.updateItem({
  TableName: 'JiraTable',
  Key: { PK: { S: 'PROJECT#my-project' }, SK: { S: 'PROJECT#my-project' } },
  ConditionExpression: 'attribute_exists(PK)',          // parent must exist (from the example code)
  UpdateExpression: 'SET #count = #count + :incr',
  ExpressionAttributeNames: { '#count': 'IssueCount' },
  ExpressionAttributeValues: { ':incr': { N: '1' } },
  ReturnValues: 'UPDATED_NEW'
}).promise()
const issueNumber = resp.Attributes.IssueCount.N

// Step 2: create the child with that number
await dynamodb.putItem({
  TableName: 'JiraTable',
  Item: { PK: { S: 'PROJECT#my-project' }, SK: { S: `ISSUE#${issueNumber}` } /* ... */ },
  ConditionExpression: 'attribute_not_exists(PK)'
}).promise()
```

- The increment is atomic, so concurrent creators never receive the same number.
- Cost: two requests per create. Accepted as the price of sequential IDs.
- Zero-pad the number in the sort key (`ISSUE#0000042`) if issues must list in numeric order. The GitHub example does this.
- Several entity types can share one counter when they share a number space; the GitHub example uses a single `IssueAndPullRequestCount` on the Repo.
- Not from the book: the two steps are not one transaction, so a failure between them burns a number and leaves a gap. If gaps are unacceptable the design needs more than this pattern. Also, `SET #count = #count + :incr` fails when the attribute is missing, so initialize the counter to `0` when the parent is created.

---

## Pagination

DynamoDB pagination is almost always "walk one item collection with Query". There is no OFFSET. The cursor is **the sort key of the last item the client saw**, carried in the API URL, and the next page is a Query whose sort key condition starts just past it.

Setup: Orders under a user, newest first, page size 5.

| Entity | PK | SK |
|---|---|---|
| Order | `USER#<Username>` | `ORDER#<OrderId>` where `OrderId` is a KSUID (chronologically sortable) |

First page, `GET /users/alexdebrie/orders`:

```js
{
  TableName: 'Ecommerce',
  KeyConditionExpression: '#pk = :pk AND #sk < :sk',
  ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
  ExpressionAttributeValues: {
    ':pk': { S: 'USER#alexdebrie' },
    ':sk': { S: 'ORDER$' }             // "$" is the character right after "#": just past every ORDER#... key
  },
  ScanIndexForward: false,             // newest first
  Limit: 5
}
```

Next page, `GET /users/alexdebrie/orders?before=1YRfXS14inXwIJEf9tO5hWnL2pi`:

```js
ExpressionAttributeValues: {
  ':pk': { S: 'USER#alexdebrie' },
  ':sk': { S: 'ORDER#1YRfXS14inXwIJEf9tO5hWnL2pi' }   // strictly less than the last-seen key
}
// everything else unchanged
```

Design rules:
- The cursor needs everything required to rebuild the key condition: the partition key (here from the URL path) and the last-seen sort key element (the `before` query parameter). So the sort key must be built from values the client already holds, which is another reason to put a sortable unique ID in it.
- Use strict inequality (`<` when reading backward, `>` when reading forward) so the last-seen item is not repeated.
- The `ORDER$` upper bound keeps the first page inside the Order items when other item types share the partition. Reading forward, the first-page bound is `SK > ORDER#` instead.
- Cursor pagination is stable under inserts: new orders appear at the head and do not shift later pages the way OFFSET does.
- No "jump to page N" and no total count. If the UI needs a total, maintain it with a reference count.
- A filter expression on a paginated Query makes page sizes unpredictable; put the filter attribute in the key instead.
- The book's printed snippets separate the two key conditions with a comma and pass untyped values; the correct form is `AND` with typed attribute values, as above.
- Not from this part of the book: DynamoDB's native `LastEvaluatedKey` / `ExclusiveStartKey` do the same job. The URL-cursor design is preferred for public APIs because the cursor is short, meaningful, and reconstructible from a displayed item.

---

## Singleton items

Most key patterns are templates filled in per entity (`USER#<Username>`). A singleton item has a fixed, literal key and exists once in the table. Use it for application-wide state or for a pre-assembled "meta view".

| Use | Example |
|---|---|
| Global state / global limits | At most 100 background jobs in progress across the application |
| Assembled view | Front page content in the deals example, read with one GetItem |

Design (job limiter):

| Item | PK | SK | Attributes |
|---|---|---|---|
| Jobs singleton | `JOBS` | `JOBS` | `JobsInProgress` (string set of job IDs) |
| Job | `JOB#<JobId>` | `JOB#<JobId>` | `Status`, ... |

(The Job key pattern is illustrative; the singleton key and the `JobsInProgress` string set are from the book.)

Starting a job is one transaction with two writes:
1. Update the singleton: add the job ID to `JobsInProgress`, on condition that the set currently has fewer than 100 members.
2. Update the Job item: set its status to `IN_PROGRESS`.

The book describes these steps without code. A sketch of the parameters (not from the book):

```js
{
  TransactItems: [
    { Update: {
        TableName: 'JobsTable',
        Key: { PK: { S: 'JOBS' }, SK: { S: 'JOBS' } },
        ConditionExpression: 'attribute_not_exists(#jobs) OR size(#jobs) < :max',
        UpdateExpression: 'ADD #jobs :job',
        ExpressionAttributeNames: { '#jobs': 'JobsInProgress' },
        ExpressionAttributeValues: { ':job': { SS: ['job-123'] }, ':max': { N: '100' } } } },
    { Update: {
        TableName: 'JobsTable',
        Key: { PK: { S: 'JOB#job-123' }, SK: { S: 'JOB#job-123' } },
        ConditionExpression: 'attribute_exists(PK)',
        UpdateExpression: 'SET #status = :s',
        ExpressionAttributeNames: { '#status': 'Status' },
        ExpressionAttributeValues: { ':s': { S: 'IN_PROGRESS' } } } }
  ]
}
```

Finishing a job is the mirror transaction (`DELETE #jobs :job` plus the status change).

Caveats (not from the book): every writer hits the same item, so a singleton is a single hot key and a contention point for transactions, and it is bound by the 400KB item size limit. Suitable for low-to-moderate write rates and small payloads.

---

## Reference counts

When a parent is displayed with "number of related items" (stars on a repo, likes or retweets on a post), do not Query and count the children on every read; that burns read capacity proportional to the count just to produce one integer. Store the count on the parent and maintain it on every write.

Adding a related item needs two things to succeed together:
1. The related item does not already exist (this user has not already starred this repo).
2. The parent's counter goes up by one.

That is one transaction:

```js
{
  TransactItems: [
    { Put: {
        TableName: 'GitHubModel',
        Item: { PK: { S: 'REPO#alexdebrie#dynamodb-book' }, SK: { S: 'STAR#danny-developer' } /* ... */ },
        ConditionExpression: 'attribute_not_exists(PK)' } },         // no double-counting
    { Update: {
        TableName: 'GitHubModel',
        Key: { PK: { S: 'REPO#alexdebrie#dynamodb-book' }, SK: { S: 'REPO#alexdebrie#dynamodb-book' } },
        ConditionExpression: 'attribute_exists(PK)',                 // parent must exist
        UpdateExpression: 'SET #count = #count + :incr',
        ExpressionAttributeNames: { '#count': 'StarCount' },
        ExpressionAttributeValues: { ':incr': { N: '1' } } } }
  ]
}
```

- The `attribute_not_exists` condition on the child is what keeps the count honest: a duplicate request cancels the whole transaction, so the counter is not incremented twice.
- Map cancellation reasons by position to give precise errors: reason `[0]` failed means "already exists", reason `[1]` failed means "parent not found". The example code does exactly this.
- The transaction replaces the older approach of separate writes with manual rollback on failure.
- Use the parent's real key for the Update. The book's snippet for this pattern shows the Repo sort key with a leading `#` (`#REPO#...`) while the filtering chapter shows it without; follow whatever the table's Repo key pattern actually is.
- Removal is the mirror image (implied, not shown in the book): delete the child with `attribute_exists(PK)` and decrement the counter in one transaction.
- Not from the book: initialize the counter to `0` at parent creation, since `SET #count = #count + :incr` fails on a missing attribute.

---

## Strategy summary

| Strategy | Mechanism | Requests | Seen in |
|---|---|---|---|
| Uniqueness on 2+ attributes | One tracking item per unique attribute; transaction of Puts with `attribute_not_exists` | 1 transaction | E-commerce users (username + email) |
| Sequential IDs | Counter on parent; `UpdateItem` increment with returned value; then `PutItem` child | 2 | GitHub issues and pull requests |
| Pagination | Last-seen sort key in the URL; `SK <` or `SK >` cursor; `Limit` | 1 per page | E-commerce orders |
| Singleton item | Fixed literal PK/SK; global state or assembled view | Varies | Deals front page; job limiter |
| Reference count | Transaction: conditional Put of child + counter increment on parent | 1 transaction | Deals; GitHub stars |
