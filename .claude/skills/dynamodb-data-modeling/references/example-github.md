# Worked Example: GitHub Backend and Its Migration

A full single-table model for a highly relational application (repos, issues, pull requests, comments, reactions, stars, forks, users, organizations), followed by a year-later migration that adds entities and reworks an access pattern. Read it when modeling many interrelated entities in one table, or when deciding how to evolve an existing table (lazy change vs backfill vs new index).

Sources: book chapters 21 and 22, plus the `github-node` and `github-migration-node` code. Where the code and the book text disagree, both are shown and the difference is called out.

## Contents

- [Part 1: The original model](#part-1-the-original-model)
  - [Requirements and ERD](#requirements-and-erd)
  - [Access patterns](#access-patterns)
  - [Final entity chart](#final-entity-chart)
  - [Item collection layouts](#item-collection-layouts)
  - [Key decisions and the strategy behind each](#key-decisions-and-the-strategy-behind-each)
  - [Access pattern to operation map](#access-pattern-to-operation-map)
  - [Code: table, key helpers, writes, reads](#code-table-key-helpers-writes-reads)
- [Part 2: The migration](#part-2-the-migration)
  - [Migration difficulty ladder](#migration-difficulty-ladder)
  - [Change 1: Code of Conduct](#change-1-code-of-conduct-new-attribute-lazy)
  - [Change 2: Gists](#change-2-gists-new-entity-in-an-existing-collection-no-etl)
  - [Change 3: GitHub Apps and installations](#change-3-github-apps-and-installations-new-collections-partial-etl)
  - [Change 4: Open and closed issues and PRs](#change-4-open-and-closed-issues-and-prs-refactor-etl-plus-new-indexes)
  - [Migration scripts](#migration-scripts)
  - [Entity chart after the migration](#entity-chart-after-the-migration)
- [Book vs code differences](#book-vs-code-differences)
- [Reusable lessons](#reusable-lessons)

---

## Part 1: The original model

### Requirements and ERD

In scope: Repos, Users, Organizations, Payment Plans, Forks, Issues, Pull Requests, Comments, Reactions, Stars. Out of scope: git contents (files, branches, commits), which are mostly search-shaped and belong in another system.

Business rules that drive the keys:

| Rule | Modeling consequence |
|---|---|
| A repo has exactly one owner (User or Organization); owner + repo name is globally unique | Repo key is `REPO#<Owner>#<RepoName>` |
| User names and organization names share one namespace | Both use the same `ACCOUNT#<Name>` key |
| Issues and PRs in a repo share one incrementing number sequence | One counter attribute on the Repo item |
| Issues and PRs are listed newest first, filtered by Open or Closed | Descending sort on number; status filter |
| A user can star a repo once; orgs cannot star | Star item keyed by repo + username |
| A fork is itself a full repo owned by someone else; forks are listed ascending by forking owner | Fork is a Repo item, grouped in a GSI |
| Comments are flat (no threading), unbounded, only read in the context of their issue or PR | Own item collection per target |
| 8 reaction types; a user can apply each type once per target; counts per type are displayed | Per-user tracking item plus counts on the target |
| Star and fork counts are shown on the repo page (can exceed 100k) | Reference counts on the Repo item |

Relationships:

| Relationship | Type | Bounded? |
|---|---|---|
| User - Organization (membership) | many-to-many | orgs per user: small; users per org: unbounded |
| User/Org - Payment Plan | one-to-one | n/a |
| User/Org - Repo | one-to-many | unbounded |
| Repo - Issue, Repo - Pull Request | one-to-many | unbounded |
| Repo - Repo (fork) | one-to-many | unbounded |
| User - Repo (star) | many-to-many | unbounded |
| Issue/PR - Comment | one-to-many | unbounded |
| Issue/PR/Comment - Reaction | one-to-many | bounded per user (8 types) |

There is no access pattern that fetches issues, PRs, or comments by the user who authored them, so that relationship is deliberately not modeled.

### Access patterns

The book lists 24 patterns in four groups.

- **Repo basics:** Get / Create Repo; Get / Create / List Issues for Repo; Get / Create / List Pull Requests for Repo; Fork Repo; Get Forks for Repo.
- **Interactions:** Add Comment to Issue; Add Comment to Pull Request; Add Reaction to Issue / Pull Request / Comment; Star Repo; Get Stargazers for Repo.
- **User management:** Create User; Create Organization; Add User to Organization; Get Users for Organization; Get Organizations for User.
- **Accounts and repos:** Get Repos for User; Get Repos for Organization.

The code also implements Get Comments for Issue / PR, Update Issue / PR, and Update Payment Plan for User / Organization.

### Final entity chart

One table, composite primary key (`PK`, `SK`), three GSIs (`GSI1`..`GSI3`), all with `ProjectionType: ALL`. Keys below are as implemented in `github-node` (all name segments lowercased).

| Entity | PK | SK |
|---|---|---|
| Repo | `REPO#<Owner>#<RepoName>` | `REPO#<Owner>#<RepoName>` |
| Issue | `REPO#<Owner>#<RepoName>` | `ISSUE#<ZeroPaddedIssueNumber>` |
| Star | `REPO#<Owner>#<RepoName>` | `STAR#<Username>` |
| Pull Request | `PR#<Owner>#<RepoName>#<ZeroPaddedPRNumber>` | same as PK |
| IssueComment | `ISSUECOMMENT#<Owner>#<RepoName>#<ZeroPaddedIssueNumber>` | `ISSUECOMMENT#<CommentId>` |
| PRComment | `PRCOMMENT#<Owner>#<RepoName>#<ZeroPaddedPRNumber>` | `PRCOMMENT#<CommentId>` |
| Reaction | `<TargetType>REACTION#<Owner>#<RepoName>#<TargetIdentifier>#<Username>` | same as PK |
| User | `ACCOUNT#<Username>` | `ACCOUNT#<Username>` |
| Organization | `ACCOUNT#<OrgName>` | `ACCOUNT#<OrgName>` |
| Membership | `ACCOUNT#<OrgName>` | `MEMBERSHIP#<Username>` |
| Payment Plan | n/a (attribute on User / Organization) | n/a |
| Fork | n/a (a Repo item with different GSI2 keys) | n/a |

| Entity | GSI1PK | GSI1SK | GSI2PK | GSI2SK | GSI3PK | GSI3SK |
|---|---|---|---|---|---|---|
| Repo (original) | `REPO#<Owner>#<RepoName>` | `REPO#<Owner>#<RepoName>` | `REPO#<Owner>#<RepoName>` | `#REPO#<Owner>#<RepoName>` | `ACCOUNT#<Owner>` | `#<UpdatedAt>` |
| Repo (fork) | same | same | `REPO#<OriginalOwner>#<RepoName>` | `FORK#<Owner>` | same | same |
| Pull Request | `REPO#<Owner>#<RepoName>` | `PR#<ZeroPaddedPRNumber>` | | | | |
| User | | | | | `ACCOUNT#<Username>` | `ACCOUNT#<Username>` |
| Organization | | | | | `ACCOUNT#<OrgName>` | `ACCOUNT#<OrgName>` |

What each index is for:

| Index | Item collection | Serves |
|---|---|---|
| Base table | Repo + Issues + Stars; Org + Memberships; one collection per comment target | Repo and issues, repo and stargazers, org and members, comments for a target |
| GSI1 | Repo + Pull Requests | Repo and its PRs, newest first |
| GSI2 | Original Repo + its Forks | Forks for a repo, ascending by forking owner |
| GSI3 | Account + its Repos | Repos for a user or org, most recently updated first |

### Item collection layouts

Sort order within the busiest collections (ascending). Reads start at the parent item and go in one direction.

```
Base table, PK = REPO#alexdebrie#dynamodb-book
  ISSUE#0000001
  ISSUE#0000004
  ISSUE#0000015                    <- read backward from Repo: newest issues first
  REPO#alexdebrie#dynamodb-book    <- parent sits in the middle
  STAR#danny-developer             <- read forward from Repo: stargazers
  STAR#happy-harry

GSI1, GSI1PK = REPO#alexdebrie#dynamodb-book
  PR#0000002
  PR#0000005                       <- read backward from Repo: newest PRs first
  REPO#alexdebrie#dynamodb-book

GSI2, GSI2PK = REPO#alexdebrie#dynamodb-book
  #REPO#alexdebrie#dynamodb-book   <- original repo, forced first by the # prefix
  FORK#megacorp                    <- forks ascending by forking owner
  FORK#zed

GSI3, GSI3PK = ACCOUNT#alexdebrie
  #2020-01-04T...                  <- repos, sorted by UpdatedAt
  #2020-03-21T...
  ACCOUNT#alexdebrie               <- account last; read backward: account, then newest repos

Base table, PK = ACCOUNT#megacorp
  ACCOUNT#megacorp                 <- organization
  MEMBERSHIP#alexdebrie            <- read forward: members alphabetically
```

### Key decisions and the strategy behind each

**Start with the core entity.** Repo has the most access patterns and is the parent of three one-to-many relationships (issues, PRs, forks) plus a many-to-many (stars). Model it first, then comments and reactions, then accounts.

**Repo + Issues in the base table (primary key + Query).** Issues are unbounded, so denormalizing onto the Repo is out. Give Issues the Repo's partition key and a sort key (`ISSUE#...`) that sorts before the Repo item. A reverse Query from the Repo item returns the Repo followed by the newest issues in one request.

**Why PRs cannot share that collection.** One item collection can hold two child types around a parent only if one is read ascending and the other descending. Issues and PRs both need descending order, so only one can sit before the Repo. Issues were picked arbitrarily; PRs get their own base-table key (`PR#<Owner>#<Repo>#<Number>` as both PK and SK, long because it must be unique across all repos) and are regrouped with the Repo in GSI1, where the Repo copies its own key into `GSI1PK`/`GSI1SK`.

**Stars use the other side of the Repo collection.** Stargazers have no required order, so they can be read ascending. `STAR#<Username>` sorts after `REPO#...`, so the same collection now holds two relationships with the parent in the middle. Consequence: every query on this collection needs a sort key bound at the Repo item (`SK <= repo` for issues, `SK >= repo` for stars), otherwise it runs into the other child type.

**Zero-padded numbers.** Issue and PR numbers live inside string sort keys, and strings compare character by character, so `ISSUE#10` would sort before `ISSUE#9`. Pad to a fixed width (`ISSUE#0000010`). The fixed width also caps the maximum number, which matters for the migration trick in Part 2.

**Shared sequential numbering via a counter.** DynamoDB has no auto-increment. Emulate it with two requests:

1. `UpdateItem` on the Repo: `SET #count = #count + :inc` on `IssueAndPullRequestCount`, returning the new value (`ReturnValues`).
2. `PutItem` the Issue or PR using the returned number, with `attribute_not_exists(PK)`.

The increment is atomic, so concurrent creators get distinct numbers, and one counter serves both entity types so numbers never collide across issues and PRs. The cost is two round trips per create, accepted as the best available way to get a sequential ID. This is two separate calls, not a transaction, because the number must be read before the item key can be built. (Observation, not from the book: if step 2 fails, the number from step 1 is skipped, leaving a gap.)

**Open vs closed with a filter expression (initial choice).** Two options: build status into a key, or filter. The filter was chosen here because (a) only two values exist, so the ratio of returned to read items should be high, and (b) pages are small (25 items), so a few extra reads usually suffice. The filter is `attribute_not_exists(#status) OR #status = :status`; the first clause lets the Repo item (which has no `Status`) through. Known weakness: you cannot predict how many items to read to get 25 matches, so you over-fetch (for example read 75 first, then follow up unbounded). The advice was to measure in production and move status into the key if it wastes capacity. Part 2 does exactly that.

**Forks via a GSI, not a new entity.** A fork is a Repo for its owner, with its own issues and PRs, so it stays a normal Repo item. The relationship to the upstream lives only in GSI2: an original repo writes `GSI2PK = REPO#<Owner>#<Repo>`, `GSI2SK = #REPO#...`; a fork writes `GSI2PK = REPO#<OriginalOwner>#<Repo>`, `GSI2SK = FORK#<Owner>`. The `#` prefix forces the original to the top of the collection so one forward Query returns the upstream followed by forks in owner order. This relies on a fork keeping the upstream's repo name.

**Reference counts for stars and forks.** Counting 100k+ items per page view is too slow, so `StarCount` and `ForkCount` live on the Repo item. Each star or fork is a transaction: Put the Star (or fork Repo) with `attribute_not_exists(PK)`, and Update the Repo counter with `attribute_exists(PK)`. If the star already exists, the whole transaction fails and the count stays right. Rule: whenever a count must match the number of tracking items, write both in one `TransactWriteItems`.

**Comments: grouped, but not with their parent.** No pattern fetches an issue together with its comments, only "all comments for this issue". So comments just need a shared partition key per target (`ISSUECOMMENT#<Owner>#<Repo>#<Number>`) and a KSUID sort key for chronological order and uniqueness. The parent is not in the collection. Do not co-locate a parent with children unless a pattern needs them in one read.

**Reactions: one tracking item per user per target, counts in a map.** Rather than eight counter attributes and up to eight tracking items, use complex attributes:

- On each Issue, PR, and Comment: a map of reaction type to count.
- A Reaction item per (target, user) holding a string set of the reaction types that user has applied.

Adding a reaction is a transaction: `ADD` the type to the user's set with a condition that it is not already present, and increment that type's count on the target. This is the stars pattern generalized to eight sub-counters per target.

**Users and Organizations share `ACCOUNT#<Name>`.** Uniqueness is only enforceable through the primary key, and users and orgs compete for the same names, so they must share a key shape. `attribute_not_exists(PK)` on create then enforces the namespace across both. A `Type` attribute (`User` / `Organization`) tells them apart. It is not queryable, which is fine because no pattern asks for "all users where..." or "all orgs where...". The code guards deserialization by throwing if `Type` does not match the expected entity.

**Membership: two different strategies for the two sides of a many-to-many.** The relationship is shallow (a user's page only needs org names and roles).

- User side: an `Organizations` map attribute on the User item (org name to role). This is bounded duplication; a cap such as 40 orgs per user is acceptable.
- Organization side: a `Membership` item per member in the org's item collection (`SK = MEMBERSHIP#<Username>`), because member counts are unbounded and billing depends on them, so an artificial cap is not acceptable.

Adding a member writes both sides in one transaction.

**Payment plan as a complex attribute.** One-to-one data goes on the parent item unless it is large and rarely needed with the parent. A plan is small, so it is a `PaymentPlan` attribute on the User or Organization.

**Repos for an account in GSI3.** Unbounded, so Query-based. The Repo's primary key and GSI1/GSI2 are all occupied by other relationships, so a third index is needed. Repos are shown most recently updated first, so `GSI3SK = #<UpdatedAt>` on the Repo and the account item copies its own key into GSI3. `#` sorts before `A`, so the account item is last and a reverse Query returns the account, then repos newest first.

### Access pattern to operation map

`o` = owner, `r` = repo name. Limits are what the code uses.

| Access pattern | Index | Operation and key condition |
|---|---|---|
| Create Repo | base | `PutItem`, `attribute_not_exists(PK)` |
| Get Repo | base | `GetItem` `PK = SK = REPO#o#r` |
| Create Issue | base | `UpdateItem` counter on Repo, then `PutItem` `SK = ISSUE#<padded>` |
| Get Issue | base | `GetItem` `PK = REPO#o#r`, `SK = ISSUE#<padded>` |
| Repo + Issues (by status) | base | `Query` `PK = REPO#o#r AND SK <= REPO#o#r`, `ScanIndexForward=false`, status filter |
| Update Issue | base | `UpdateItem`, `attribute_exists(PK)` |
| Create PR | base | `UpdateItem` counter on Repo, then `PutItem` `PK = SK = PR#o#r#<padded>` |
| Get PR | base | `GetItem` `PK = SK = PR#o#r#<padded>` |
| Repo + PRs (by status) | GSI1 | `Query` `GSI1PK = REPO#o#r AND GSI1SK <= REPO#o#r`, backward, status filter |
| Fork Repo | base | `TransactWriteItems`: Put fork Repo (not exists) + increment `ForkCount` on original (exists) |
| Repo + Forks | GSI2 | `Query` `GSI2PK = REPO#o#r`, forward, `Limit 26` |
| Add Comment to Issue / PR | base | `TransactWriteItems`: Put comment (not exists) + `ConditionCheck` parent exists |
| Comments for Issue / PR | base | `Query` `PK = ISSUECOMMENT#o#r#<padded>` (or `PRCOMMENT#...`) |
| Add Reaction | base | `TransactWriteItems`: `ADD` type to user's set (not already present) + increment count on target |
| Star Repo | base | `TransactWriteItems`: Put Star (not exists) + increment `StarCount` (repo exists) |
| Repo + Stargazers | base | `Query` `PK = REPO#o#r AND SK >= REPO#o#r`, forward, `Limit 26` |
| Create User | base | `PutItem`, `attribute_not_exists(PK)` |
| Get User (includes orgs for user, payment plan) | base | `GetItem` `PK = SK = ACCOUNT#<name>` |
| Create Organization | base | `TransactWriteItems`: Put Org (not exists) + Put owner Membership + set org in owner's `Organizations` map |
| Add User to Organization | base | `TransactWriteItems`: Put Membership (not exists) + increment org `Members` + set org in user's map |
| Org + Members | base | `Query` `PK = ACCOUNT#<org>`, forward, `Limit 26` |
| Account + Repos | GSI3 | `Query` `GSI3PK = ACCOUNT#<name>`, backward, `Limit 11` |
| Update Payment Plan | base | `UpdateItem`, condition `attribute_exists(PK) AND #type = :type` |

Every "parent + children" query takes the first returned item as the parent and treats the rest as children, which only works because the read starts at the parent item.

### Code: table, key helpers, writes, reads

**Table definition** (`serverless.yml`, trimmed). Generic key names, on-demand billing, every GSI projects all attributes.

```yaml
GitHubTable:
  Type: AWS::DynamoDB::Table
  Properties:
    AttributeDefinitions:          # PK, SK, GSI1PK, GSI1SK, ... GSI3PK, GSI3SK, all type S
      - { AttributeName: "PK", AttributeType: "S" }
      - { AttributeName: "SK", AttributeType: "S" }
      - { AttributeName: "GSI1PK", AttributeType: "S" }
      - { AttributeName: "GSI1SK", AttributeType: "S" }
    KeySchema:
      - { AttributeName: "PK", KeyType: "HASH" }
      - { AttributeName: "SK", KeyType: "RANGE" }
    BillingMode: "PAY_PER_REQUEST"
    GlobalSecondaryIndexes:
      - IndexName: 'GSI1'          # GSI2 and GSI3 are identical in shape
        KeySchema:
          - { AttributeName: "GSI1PK", KeyType: "HASH" }
          - { AttributeName: "GSI1SK", KeyType: "RANGE" }
        Projection: { ProjectionType: ALL }
```

**Key helpers.** Each entity class owns its key construction (`key()`, `gsiN()`), `toItem()` spreads them in, and an `<entity>FromItem` function parses items back. Data-access code never builds key strings by hand.

```js
const zeroPadNumber = (number) => ("0000000" + number).slice(-7)

class Repo {
    pk() { return { 'S': `REPO#${this.ownerName.toLowerCase()}#${this.repoName.toLowerCase()}` } }
    sk() { return this.pk() }
    gsi2pk() {                      // forkOwner = owner of the upstream repo, if this is a fork
        const owner = this.forkOwner || this.ownerName
        return { 'S': `REPO#${owner.toLowerCase()}#${this.repoName.toLowerCase()}` }
    }
    gsi2sk() {
        if (!this.forkOwner) return { 'S': `#REPO#${this.ownerName.toLowerCase()}#${this.repoName.toLowerCase()}` }
        return { 'S': `FORK#${this.ownerName.toLowerCase()}` }
    }
    gsi3() {
        return {
            'GSI3PK': { 'S': `ACCOUNT#${this.ownerName.toLowerCase()}` },
            'GSI3SK': { 'S': `#${this.updatedAt.toISOString()}` },
        }
    }
}
```

Lowercasing key segments makes name uniqueness case-insensitive, while the original casing is kept in plain attributes (`OwnerName`, `RepoName`).

**Create an issue with the shared counter** (`data/addIssueToRepo.js`, condensed):

```js
const resp = await dynamodb.updateItem({
    TableName: process.env.TABLE_NAME,
    Key: repo.key(),
    ConditionExpression: 'attribute_exists(PK)',          // repo must exist
    UpdateExpression: 'SET #count = #count + :inc',
    ExpressionAttributeNames: { '#count': 'IssueAndPullRequestCount' },
    ExpressionAttributeValues: { ':inc': { 'N': '1' } },
    ReturnValues: 'ALL_NEW'
}).promise()
issue.issueNumber = repoFromItem(resp.Attributes).issueAndPullRequestCount

await dynamodb.putItem({
    TableName: process.env.TABLE_NAME,
    Item: issue.toItem(),                                  // SK = ISSUE#<zero-padded number>
    ConditionExpression: 'attribute_not_exists(PK)'
}).promise()
```

`addPullRequestToRepo` is the same code against the same counter. The Repo is created with the counter at 0, so `#count + :inc` never hits a missing attribute.

**Star a repo: tracking item plus reference count in one transaction** (`data/addStarToRepo.js`):

```js
TransactItems: [
    { Put: {
        Item: star.toItem(),                               // PK = REPO#o#r, SK = STAR#user
        TableName: process.env.TABLE_NAME,
        ConditionExpression: "attribute_not_exists(PK)" } },
    { Update: {
        TableName: process.env.TABLE_NAME,
        Key: repo.key(),
        ConditionExpression: "attribute_exists(PK)",
        UpdateExpression: "SET #starCount = #starCount + :inc",
        ExpressionAttributeNames: { '#starCount': 'StarCount' },
        ExpressionAttributeValues: { ':inc': { 'N': '1' } } } }
]
```

On `TransactionCanceledException`, the code inspects `cancellationReasons[i].Code === 'ConditionalCheckFailed'` by position to return a specific error ("already starred" for index 0, "repo does not exist" for index 1). With the v2 SDK these reasons have to be extracted from the raw HTTP response in an `extractError` listener (`data/utils.js`).

**Add a reaction** (`data/addReactionToIssue.js`):

```js
TransactItems: [
    { Update: {                                            // per-user tracking item, created on first use
        TableName: process.env.TABLE_NAME,
        Key: issueReaction.key(),
        ConditionExpression: "attribute_not_exists(#reaction) OR NOT contains(#reaction, :reaction)",
        UpdateExpression: "ADD #reaction :reactionSet",
        ExpressionAttributeNames: { "#reaction": "Reaction" },
        ExpressionAttributeValues: {
            ":reaction": { "S": reaction },                // contains() on a set takes the element
            ":reactionSet": { "SS": [ reaction ] } } } },  // ADD takes a set
    { Update: {
        TableName: process.env.TABLE_NAME,
        Key: issue.key(),
        ConditionExpression: "attribute_exists(PK)",
        UpdateExpression: "SET #reactions.#reaction = #reactions.#reaction + :inc",
        ExpressionAttributeNames: { '#reactions': 'Reactions', '#reaction': reaction },
        ExpressionAttributeValues: { ':inc': { 'N': '1' } } } }
]
```

The nested increment only works because every Issue, PR, and Comment is created with a `Reactions` map pre-populated with all eight types at 0.

**Add a member: three writes, both sides of the many-to-many** (`data/addMemberToOrganization.js`): Put the Membership (`attribute_not_exists(PK)`), `SET #members = #members + :inc` on the Organization, and `SET #organizations.#org = :role` on the User (`attribute_exists(PK)` on both).

**Fetch a repo with its issues** (`github-node/data/getRepoAndIssues.js`):

```js
const resp = await dynamodb.query({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: '#pk = :pk AND #sk <= :sk',    // stop at the Repo item, skip STAR# items
    FilterExpression: "attribute_not_exists(#status) OR #status = :status",
    ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK', '#status': 'Status' },
    ExpressionAttributeValues: { ':pk': repo.pk(), ':sk': repo.sk(), ':status': { 'S': status } },
    ScanIndexForward: false
}).promise()
const repoItem = resp.Items.shift()                        // first item is the Repo
const issues = resp.Items.map(issueFromItem)
```

The PR version is identical against `GSI1` with `GSI1PK` / `GSI1SK`.

---

## Part 2: The migration

A year later there are four changes: three new entity types and one rework of an existing pattern whose original assumption failed in production. The ERD gains Code of Conduct (one-to-one with Repo), Gist (one-to-many from User only; orgs cannot own gists), and GitHub App (one-to-many from User or Org, many-to-many with Repo via installations).

New access patterns: Add Code of Conduct; Create Gist; View Gists for User; Create GitHub App; Install GitHub App to Repo; View GitHub App Installations; View GitHub Apps for Repo; Fetch Open / Closed Issues; Fetch Open / Closed Pull Requests.

### Migration difficulty ladder

Tackle changes in increasing order of difficulty. The question that decides the category is always: **do existing items need new or changed attributes?**

| # | Kind of change | Existing items touched? | In this example |
|---|---|---|---|
| 1 | New attribute | No (lazy, written when used) | Code of Conduct |
| 2 | New entity with no relationship | No | - |
| 3 | New entity + relationship in an existing item collection | No | Gists in the User collection; AppInstallations in the Repo's GSI1 collection |
| 4 | New entity + relationship in a new item collection | Yes, decorate the parent with new index keys (scan + update), or do it lazily | Apps for Account in GSI1 |
| 5 | Changing an existing pattern | Yes, backfill plus usually new indexes | Open / closed issues and PRs |

### Change 1: Code of Conduct (new attribute, lazy)

A Code of Conduct is a name and a URL, one per repo. One-to-one data goes on the parent item unless it is large and has different access patterns. It is small, so it becomes a `CodeOfConduct` attribute on the Repo.

No ETL: the attribute is not used in any key and is optional, so existing Repo items are left alone and the attribute is written when a repo registers one (`UpdateItem` `SET #codeOfConduct = :codeOfConduct`, `attribute_exists(PK)`). The reader must tolerate its absence: `repoFromItem` checks `attributes.CodeOfConduct ? ... : {}`.

### Change 2: Gists (new entity in an existing collection, no ETL)

Needs: a unique ID per gist, and "User + most recent gists" in one query.

Before adding an index, look at what already lives in the parent's base-table collection. The User collection held only the User item, so it can be reused without touching any existing item:

| Entity | PK | SK |
|---|---|---|
| Gist | `ACCOUNT#<Username>` | `#GIST#<KSUID>` |

The KSUID gives uniqueness plus chronological sort. The `#` prefix puts gists before the `ACCOUNT#` item, so a reverse query returns the User first and then gists newest first. A gist URL carries the username and gist ID, so a direct `GetItem` is possible.

```js
// data/getUserAndGists.js
KeyConditionExpression: '#pk = :pk and #sk <= :sk',   // :pk = :sk = ACCOUNT#<username>
ScanIndexForward: false,
Limit: 11                                             // user + 10 gists
```

Creation is a transaction: Put the Gist (`attribute_not_exists(PK)`) plus a `ConditionCheck` that the User item exists.

### Change 3: GitHub Apps and installations (new collections, partial ETL)

**Account + Apps (one-to-many).** The base-table account collections cannot take apps: User collections now have gists *before* the account item, Org collections have memberships *after* it, and the client does not know at query time whether a name is a user or an org, so there is no single read direction that works for both. Use a secondary index instead. Accounts only use GSI3 so far, so GSI1 is free for them (GSI1 already holds Repo + PR collections, but under `REPO#...` partition keys, so the two do not collide).

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| GitHubApp | `APP#<AccountName>#<AppName>` | `APP#<AccountName>#<AppName>` | `ACCOUNT#<AccountName>` | `APP#<AppName>` |
| User / Organization (added) | | | `ACCOUNT#<AccountName>` | `ACCOUNT#<AccountName>` |

Existing User and Org items need `GSI1PK` / `GSI1SK`. Two ways to get them there:

- **Lazy:** since apps are new, set the attributes on an account only when it creates its first app.
- **Backfill:** a one-time scan + update over all accounts. The code takes this route (`accountMigration.js`) and also writes the attributes on every newly created account.

**App - Repo installations (many-to-many, adjacency list).** Both directions fetch a parent plus its related items, and installations per app are unbounded, so use a relationship item that sits in two item collections: one in the base table, one in an index. Placement logic:

- The Repo's base-table collection is full (issues before, stars after), so the repo side must be an index.
- The new App item's base-table collection is empty, so the app side goes there.
- The Repo's GSI1 collection only has PRs before the Repo item, so installations can go after it.

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| GitHubAppInstallation | `APP#<AppOwner>#<AppName>` | `REPO#<RepoOwner>#<RepoName>` | `REPO#<RepoOwner>#<RepoName>` | `REPOAPP#<AppOwner>#<AppName>` |

The primary key contains both the app and the repo, so `attribute_not_exists(PK)` guarantees an app is installed in a repo at most once. No existing items change for this half.

| Pattern | Operation |
|---|---|
| Create App | `PutItem`, `attribute_not_exists(PK)` |
| Install App | `TransactWriteItems`: Put installation (not exists) + `ConditionCheck` app exists + `ConditionCheck` repo exists |
| App + Installations | `Query` base `PK = APP#<owner>#<app>`; the App item sorts first (`APP#` < `REPO#`) |
| Repo + Installations | `Query` GSI1 `GSI1PK = REPO#o#r AND GSI1SK >= REPO#o#r`, forward (`REPO#` < `REPOAPP#`, PRs excluded) |
| Account + Apps | `Query` GSI1 `GSI1PK = ACCOUNT#<name>` (keys are written, but the code has no handler for this query) |

### Change 4: Open and closed issues and PRs (refactor, ETL plus new indexes)

**Why the filter failed.** Poorly maintained repos have mostly open items at the top, so finding 25 recent closed ones means reading deep. And the fixed over-fetch of 75 was usually too many and sometimes too few, causing follow-up queries. The status must move into a key.

**Design steps (each attempt fails in an instructive way):**

1. Composite sort key `ISSUE#<Status>#<Number>`. Order becomes closed issues, open issues, Repo. "Repo + newest closed" breaks because open issues sit between the Repo and the closed ones.
2. Put the Repo in the middle with `#` prefixes: `#ISSUE#CLOSED#...` < `#REPO#...` < `ISSUE#OPEN#...`. Closed works (read backward), but open issues are now read forward, which returns the oldest first.
3. Four indexes, one per pattern. Works, but costs four more indexes to maintain and pay for.
4. **Chosen:** keep layout 2 and make the open side sort descending while reading forward, by storing the *difference* between the maximum number and the actual number. With 7-digit padding, issue 15 becomes `ISSUE#OPEN#9999984`; higher issue numbers produce smaller differences and therefore sort first.

Every existing index on the Repo is taken, so this needs two new indexes, one for issues and one for PRs:

| Entity | GSI4PK | GSI4SK | GSI5PK | GSI5SK |
|---|---|---|---|---|
| Repo | `REPO#<Owner>#<Repo>` | `#REPO#<Owner>#<Repo>` | `REPO#<Owner>#<Repo>` | `#REPO#<Owner>#<Repo>` |
| Open Issue | `REPO#<Owner>#<Repo>` | `ISSUE#OPEN#<ZeroPaddedDifference>` | | |
| Closed Issue | `REPO#<Owner>#<Repo>` | `#ISSUE#CLOSED#<ZeroPaddedNumber>` | | |
| Open PR | | | `REPO#<Owner>#<Repo>` | `PR#OPEN#<ZeroPaddedDifference>` |
| Closed PR | | | `REPO#<Owner>#<Repo>` | `#PR#CLOSED#<ZeroPaddedNumber>` |

```
GSI4, GSI4PK = REPO#alexdebrie#dynamodb-book
  #ISSUE#CLOSED#0000002
  #ISSUE#CLOSED#0000011            <- closed: read backward from Repo, newest first
  #REPO#alexdebrie#dynamodb-book
  ISSUE#OPEN#9999984   (issue 15)  <- open: read forward from Repo, newest first
  ISSUE#OPEN#9999995   (issue 4)
```

Key helpers and query (`github-migration-node`):

```js
const zeroPadDifference = (number) => ("0000000" + (9999999 - number)).slice(-7)

// entities/issues.js
gsi4sk() {
    if (this.status === 'Open') {
        return { 'S': `ISSUE#OPEN#${this.zeroPaddedIssueNumberDifference()}` }
    }
    return { 'S': `#ISSUE#CLOSED#${this.zeroPaddedIssueNumber()}` }
}

// data/getRepoAndIssues.js - no filter expression any more
let sign = '>=', ScanIndexForward = true                   // open: forward from the Repo
if (status.toLowerCase() === 'closed') { sign = '<='; ScanIndexForward = false }
await dynamodb.query({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI4',
    KeyConditionExpression: `#gsi4pk = :gsi4pk AND #gsi4sk ${sign} :gsi4sk`,
    ExpressionAttributeNames: { '#gsi4pk': 'GSI4PK', '#gsi4sk': 'GSI4SK' },
    ExpressionAttributeValues: { ':gsi4pk': repo.gsi4pk(), ':gsi4sk': repo.gsi4sk() },
    ScanIndexForward
}).promise()
```

**The write path must change too.** Status is now part of an index key, so closing or reopening an issue has to rewrite that key. `updateIssue` adds `#gsi4pk = :gsi4pk, #gsi4sk = :gsi4sk` to its `SET` expression (and `updatePullRequest` does the same for GSI5), computed from the new status. Forgetting this leaves the item in the wrong range of the index. In the code, any PR status other than `Open` (so both `Closed` and `Merged`) lands in the `#PR#CLOSED#` range.

**Trade-off to state openly.** Zero-padded numbers and number differences mean nothing outside the application's access code. If that obscurity is not acceptable, pay for the extra indexes (option 3) instead.

Base-table keys, GSI1 (Repo + PRs), GSI2, and GSI3 are unchanged; the old filter-based queries are simply no longer used.

### Migration scripts

Both scripts in `github-migration-node/migrations` follow the same scan + update shape and are deployed as standalone Lambda functions (`accountMigration`, `repoIssuePrMigration`) to be invoked once.

1. `Scan` the whole table with a filter on the `Type` attribute to keep only the entity types to decorate. (The filter cuts what is returned, not what is read; the scan still reads every item.)
2. For each item, deserialize it into its entity class and call `UpdateItem` with `SET` for the new index attributes, taking the values from the entity's own key helpers so the backfill and live writes can never disagree.
3. Continue while the response contains `LastEvaluatedKey`.

```js
// migrations/accountMigration.js (condensed): decorate Users and Orgs for GSI1
const scanParams = {
    TableName: process.env.TABLE_NAME,
    FilterExpression: "#type IN (:user, :org)",
    ExpressionAttributeNames: { "#type": "Type" },
    ExpressionAttributeValues: { ':user': { 'S': 'User' }, ':org': { 'S': 'Organization' } }
}
const updateAccount = async (item) => {
    const entity = (item.Type.S === 'User' ? userFromItem : organizationFromItem)(item)
    return dynamodb.updateItem({
        TableName: process.env.TABLE_NAME,
        Key: entity.key(),
        UpdateExpression: "SET #gsi1pk = :gsi1pk, #gsi1sk = :gsi1sk",
        ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK', '#gsi1sk': 'GSI1SK' },
        ExpressionAttributeValues: { ':gsi1pk': entity.gsi1pk(), ':gsi1sk': entity.gsi1sk() }
    }).promise()
}
```

`repoIssuePrMigration.js` scans with `#type IN (:repo, :issue, :pr)` and dispatches by type:

| Item type | Attributes set |
|---|---|
| Repo | `GSI4PK`, `GSI4SK`, `GSI5PK`, `GSI5SK` |
| Issue | `GSI4PK`, `GSI4SK` (open or closed form, from the item's current `Status`) |
| PullRequest | `GSI5PK`, `GSI5SK` |

Each page of scan results is updated concurrently with `Promise.all`.

Things to fix or add before using this shape for real:

- **Pagination bug in both scripts:** the loop assigns `scanParams.exclusiveStartKey` (lowercase `e`). The API parameter is `ExclusiveStartKey`, so the scripts only work as written when the table fits in a single scan page.
- The book's hardening list: parallel scans, error handling, and batching writes. The scripts log and swallow errors, with no retry.
- Updates are idempotent `SET`s derived from the item itself, so the scripts can be re-run safely.
- Deployment (from the code's README): CloudFormation creates only one new GSI per stack update, so GSI4 and GSI5 are added in two deploys. The 200-resources-per-stack limit also forced some older endpoints to be commented out.

Rollout order (inferred from the code, not spelled out in the book): ship entity code that writes the new attributes on every create and update, add the indexes, run the backfill for older items, then switch reads to the new index.

### Entity chart after the migration

Base table additions (everything from Part 1 is unchanged):

| Entity | PK | SK |
|---|---|---|
| CodeOfConduct | n/a (attribute on Repo) | n/a |
| Gist | `ACCOUNT#<Username>` | `#GIST#<GistId>` |
| GitHubApp | `APP#<AccountName>#<AppName>` | `APP#<AccountName>#<AppName>` |
| GitHubAppInstallation | `APP#<AccountName>#<AppName>` | `REPO#<RepoOwner>#<RepoName>` |

GSI1 after the migration (two kinds of partition share the index):

| Entity | GSI1PK | GSI1SK |
|---|---|---|
| Repo | `REPO#<Owner>#<RepoName>` | `REPO#<Owner>#<RepoName>` |
| Pull Request | `REPO#<Owner>#<RepoName>` | `PR#<ZeroPaddedPRNumber>` |
| GitHubAppInstallation | `REPO#<RepoOwner>#<RepoName>` | `REPOAPP#<AppOwner>#<AppName>` |
| User / Organization | `ACCOUNT#<AccountName>` | `ACCOUNT#<AccountName>` |
| GitHubApp | `ACCOUNT#<AccountName>` | `APP#<AppName>` |

GSI2 and GSI3 are unchanged. GSI4 and GSI5 are as shown in Change 4.

---

## Book vs code differences

Prefer the code where the book's prose and its own summary charts disagree; the code is internally consistent.

| Topic | Book text | Code |
|---|---|---|
| Zero-padding width | 7 digits in chapter 21; 8 digits and max `99999999` in chapter 22 | 7 digits everywhere; difference is `9999999 - n` |
| Counter attribute | `IssuesAndPullRequestCount`, `ReturnValues='UPDATED_NEW'` | `IssueAndPullRequestCount`, `ReturnValues: 'ALL_NEW'`, plus `attribute_exists(PK)` so a missing repo fails |
| Issue SK in the counter snippet | `ISSUE#{current_count}` (unpadded) | zero-padded via the entity helper |
| PR `GSI1PK` | Prose: `REPO#<Owner>#<Repo>`; summary charts: `PR#<Owner>#<Repo>` | `REPO#<Owner>#<Repo>` (required, it must match the Repo's `GSI1PK`) |
| Original repo `GSI2SK` | Prose: `#REPO#<RepoName>`; summary chart: `REPO#<Owner>#<Repo>` | `#REPO#<Owner>#<Repo>` |
| Repo `GSI3SK` | `+#<UpdatedAt>` in prose, `#<UpdatedAt>` in the chart | `#<UpdatedAt ISO string>` |
| Star PK | `REPO#<RepoName>` in prose | `REPO#<Owner>#<Repo>`; Star is also missing from the book's final charts |
| Comment PK | unpadded issue / PR number | zero-padded number |
| Reaction key | `<TargetType>REACTION#o#r#<TargetIdentifier>#<User>`, target types `ISSUE`, `PR`, `ISSUECOMMENT`, `PRCOMMENT`; comment identifier = issue/PR number + comment ID | Types `ISSUE`, `PR`, `COMMENT`; identifier is `<TYPE>#<id>`, giving for example `ISSUEREACTION#o#r#ISSUE#4#<user>` and `COMMENTREACTION#o#r#COMMENT#<commentId>#<user>`; username not lowercased here |
| Reaction attributes | String set `Reactions` on the tracking item; counts attribute named `ReactionCounts` in prose | String set `Reaction` on the tracking item; counts map `Reactions` on the target |
| Reaction condition | `contains(#reactions, :reaction)` reusing the `SS` value | separate `S` value for `contains` and `SS` value for `ADD` |
| Payment plan, Code of Conduct | map attributes | JSON-serialized string attributes (`S`); new repos always write `CodeOfConduct` (an empty object string) |
| Repo + Issues query | no sort key condition at first, then notes one is needed once Stars share the collection | `SK <= REPO#...`; no `Limit` and no 75-item over-fetch logic |
| Organization member count | not mentioned | `Members` number on the Org, incremented when a member is added (the reader then parses it from the wrong type descriptor, `Members.S`) |
| Gist SK | `#GIST#<KSUID>` in prose, `GIST#<GistId>` in the final chart | `#GIST#<KSUID>` (the `#` is required for the read order) |
| User + Gists query | `PK` only, backward | adds `SK <= ACCOUNT#<user>`, `Limit 11` |
| Repo `GSI4SK` / `GSI5SK` | attribute list: `REPO#...`; final charts: `#REPO#...` | `#REPO#...` (required so the Repo sorts between closed and open) |
| Issue `GSI4PK`, PR `GSI5PK` | attribute list: `#REPO#...`; final charts: `REPO#...` | `REPO#...` |
| PR statuses | Open / Closed | Open / Closed / Merged; non-open goes in the closed key range, and the migrated list query treats any status other than `closed` as open |
| Account + Apps | described as a required pattern | GSI1 keys are written but no query or handler exists |
| Account backfill vs lazy | presents both options | backfill script, plus new accounts always get GSI1 keys |

## Reusable lessons

- Pick the core entity, then fill its base-table collection first: at most one child type read descending (before the parent) and one read ascending (after it). Additional child types go to GSIs.
- Use prefix characters (`#`) and fixed-width encodings to force an item to a specific position in a collection. Sort order is a design tool.
- Entities that must be unique in a shared namespace must share a primary key pattern; distinguish them with a `Type` attribute and guard on it when deserializing.
- An entity that is "the same thing seen from another angle" (fork vs repo) is one item with extra index keys, not a second entity.
- Pair every tracking item with its reference count in a transaction, with a not-exists condition on the tracker.
- A many-to-many can use a different strategy per side: bounded map attribute on one, relationship items on the other.
- A filter expression is acceptable for low-cardinality filters on small pages, but measure it; if it wastes reads, encode the filter in a key.
- Before adding an index during a migration, check for free space: an empty side of an existing item collection, or an existing GSI the entity does not use yet.
- When an attribute becomes part of an index key, every write path that changes it must rewrite the key, and existing items need a scan + update backfill driven by the same key helpers as live writes.
