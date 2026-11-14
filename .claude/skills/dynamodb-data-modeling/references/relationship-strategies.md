# Relationship Strategies: One-to-Many and Many-to-Many in DynamoDB

The five strategies for one-to-many relationships and the four for many-to-many relationships, each with its key design, the questions that decide whether it fits, and its costs. Read this when an ERD relationship needs to be turned into item types and key templates, or when reviewing whether an existing design picked the right strategy.

## Contents

- [How to use strategies](#how-to-use-strategies)
- [One-to-many strategies](#one-to-many-strategies)
  - [1. Complex attribute](#1-denormalize-with-a-complex-attribute)
  - [2. Duplicating data](#2-denormalize-by-duplicating-data)
  - [3. Composite primary key + Query](#3-composite-primary-key--query)
  - [4. Secondary index + Query](#4-secondary-index--query)
  - [5. Composite sort key for hierarchies](#5-composite-sort-key-for-hierarchical-data)
- [Many-to-many strategies](#many-to-many-strategies)
  - [1. Shallow duplication](#1-shallow-duplication)
  - [2. Adjacency list](#2-adjacency-list)
  - [3. Materialized graph](#3-materialized-graph)
  - [4. Normalization and multiple requests](#4-normalization-and-multiple-requests)
- [Selection tables](#selection-tables)

---

## How to use strategies

Relational modeling has one answer per problem: duplicate data goes to its own table, one-to-many gets a foreign key, many-to-many gets a join table. DynamoDB has several answers per problem and the right one depends on the access patterns, the size of the related set, and how the data changes. Two competent designers can produce very different tables for the same application.

Working method:

- Take one access pattern at a time and find the strategy that solves it.
- Expect to mix strategies in one table. A single design commonly uses a complex attribute for one relationship, an item collection for another, and a secondary index for a third.
- Decide per relationship, not per table.

Table layouts below are reconstructed from the book's descriptions. Attribute values are illustrative unless they appear as key templates. The deciding questions come from the book; some bullets under "Costs" (index write cost and eventual consistency, delimiter and partition-skew cautions, paging and reverse-direction notes) are engineering consequences spelled out here rather than statements the book makes in these chapters.

---

## One-to-many strategies

The core problem in every one-to-many relationship: when fetching one or more child items, how do you also get information about the parent (or, fetching the parent, get the children) without a join?

### 1. Denormalize with a complex attribute

**Problem it solves:** the children are only ever read and written as part of the parent, so they do not need to be items at all.

**Design:** store the children in a list or map attribute on the parent item. This intentionally breaks first normal form.

Example: a Customer with saved mailing addresses.

| PK | SK | Attributes |
|---|---|---|
| `CUSTOMER#<CustomerId>` | `CUSTOMER#<CustomerId>` | `Name`, `MailingAddresses: { "Home": { street, city, state, zip }, "Business": { ... } }` |

(The key template here is illustrative; the point is the `MailingAddresses` map on the Customer item.)

**Deciding questions.** If the answer to either is yes, do not use this strategy:

1. **Is there any access pattern based on values inside the complex attribute?** Lists and maps cannot be part of a primary key or index key, so you cannot query by their contents. "Find a customer by mailing address" would rule this out. "Show the customer's saved addresses at checkout" is fine because it is always in the context of the customer.
2. **Is the amount of data unbounded?** An item cannot exceed 400KB. Use this only when the application can reasonably cap the count (for example a maximum of 20 addresses). Order Items on an Order are the counter-example: you would not cap how many things a customer can buy, so they must be separate items.

**Costs:**
- No direct access to an individual child and no querying across children.
- Every read of the parent pays for the whole attribute.
- A hard ceiling from the item size limit; the cap must be enforced by the application.

### 2. Denormalize by duplicating data

**Problem it solves:** when reading a child you need a few facts about its parent, and you do not want a second request to get them.

**Design:** copy the needed parent attributes onto each child item. This intentionally breaks second normal form.

Example: Books and their Author (assume one author per book). The author's biographical details are stored on every Book item.

| PK | SK | AuthorBirthdate | Other attributes |
|---|---|---|---|
| `AUTHOR#Stephen King` | `BOOK#It` | 1947-09-21 | ... |
| `AUTHOR#Stephen King` | `BOOK#The Shining` | 1947-09-21 | ... |
| `AUTHOR#J.K. Rowling` | `BOOK#Harry Potter and the Sorcerer's Stone` | 1965-07-31 | ... |

(Key shapes and values are illustrative. What matters is that each Book item repeats the author's details.)

**Deciding questions:**

1. **Is the duplicated information immutable?** If yes (a birth date, a historical fact), duplicate freely. There is no consistency problem.
2. **If it can change: how often, and how many items hold a copy?**
   - Changes rarely and the items are read heavily: duplication can still be the right call, because it saves on every read.
   - Copied onto a handful of items: easy to find and update them all.
   - Copied onto thousands of items: updates are expensive and the risk of inconsistent copies is real.

You are trading faster reads against the cost of updating copies. That update cost is the product of both factors (change frequency and fan-out). If either one is low, duplication is nearly always worth it; if both are high, choose another strategy.

**Costs:**
- The application owns consistency: on change it must locate and rewrite every copy.
- Extra write capacity when the source changes.
- A window where copies disagree while an update propagates.

### 3. Composite primary key + Query

**Problem it solves:** fetch the parent together with its children, or the children alone, in one request. This is the most common one-to-many strategy and the default to try first.

**Design:** give parent and children the same partition key so they share an item collection, and distinguish them by sort key prefix.

Example: Organizations and their Users in a SaaS application.

| Entity | PK | SK |
|---|---|---|
| Organization | `ORG#<OrgName>` | `METADATA#<OrgName>` |
| User | `ORG#<OrgName>` | `USER#<UserName>` |

| PK | SK | Attributes |
|---|---|---|
| `ORG#MICROSOFT` | `METADATA#MICROSOFT` | OrgName, PlanType |
| `ORG#MICROSOFT` | `USER#BILLGATES` | UserName, UserType |
| `ORG#MICROSOFT` | `USER#SATYANADELLA` | UserName, UserType |
| `ORG#AMAZON` | `METADATA#AMAZON` | OrgName, PlanType |
| `ORG#AMAZON` | `USER#JEFFBEZOS` | UserName, UserType |

Access patterns this one key design covers:

| Access pattern | Operation | Key |
|---|---|---|
| Get an Organization | GetItem | `PK = ORG#<OrgName>`, `SK = METADATA#<OrgName>` |
| Get an Organization and all its Users | Query | `PK = ORG#<OrgName>` |
| Get only the Users of an Organization | Query | `PK = ORG#<OrgName> AND begins_with(SK, "USER#")` |
| Get one User | GetItem | `PK = ORG#<OrgName>`, `SK = USER#<UserName>` (caller must know both) |

The second row is the join replacement: the parent is located in the same item collection as its children, so the "join" happened at write time.

**Deciding questions:**

1. Is the base table's primary key still free to be shaped around this relationship? If it is needed for something else (uniqueness, another relationship), use the secondary index strategy.
2. Will the client know the parent identifier whenever it needs a child? A child's key includes the parent's ID.
3. Will other, much more numerous item types share this partition? If so, queries for "parent plus children" will drag them in (see the next strategy).

**Costs:**
- Direct access to a child requires the parent's identifier.
- An entity can be the child in only one such relationship on the base table; further relationships need indexes.
- Everything under the partition key is returned unless narrowed by a sort key condition, so mixing many item types in one collection needs care with sort key prefixes and ordering.

### 4. Secondary index + Query

**Problem it solves:** the same parent-plus-children read as strategy 3, when the base table's primary key cannot be used for it.

Typical reasons the primary key is unavailable:

- It is reserved for a write-side purpose, such as enforcing uniqueness on an attribute.
- The data has several levels, and the item collection in the base table is already used for a different level.

**Why not just add the items to the existing collection.** Continuing the SaaS example, each User creates Tickets (ID = timestamp plus random suffix). Putting Tickets under `PK = ORG#<OrgName>` would break "get an Organization and all its Users": that query would now also return every Ticket. Tickets vastly outnumber Users, so the original pattern would read mostly irrelevant data and need many pages.

**Design:**

1. Put Ticket items in their own item collections in the base table, keyed for direct lookup.
2. Create a global secondary index `GSI1` on `GSI1PK` / `GSI1SK`.
3. Give both the User item and the Ticket items the same `GSI1PK`.

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Organization | `ORG#<OrgName>` | `METADATA#<OrgName>` | | |
| User | `ORG#<OrgName>` | `USER#<UserName>` | `ORG#<OrgName>#USER#<UserName>` | `USER#<UserName>` |
| Ticket | `TICKET#<TicketId>` | `TICKET#<TicketId>` | `ORG#<OrgName>#USER#<UserName>` | `TICKET#<TicketId>` |

The `GSI1` view of one user's item collection:

| GSI1PK | GSI1SK | Item |
|---|---|---|
| `ORG#MICROSOFT#USER#BILLGATES` | `TICKET#<older TicketId>` | Ticket |
| `ORG#MICROSOFT#USER#BILLGATES` | `TICKET#<newer TicketId>` | Ticket |
| `ORG#MICROSOFT#USER#BILLGATES` | `USER#BILLGATES` | User |

**Ordering trick.** Because `TICKET#` sorts before `USER#`, the User item is the last item in the collection, right after the newest Ticket (Ticket IDs start with a timestamp). Query with `ScanIndexForward=False` (and a `Limit`) to read backwards from the end: the User first, then the most recent Tickets. Choose prefixes on purpose so the parent sits at the end of the collection that the common read starts from.

**Deciding questions:**

1. Is the base table key already committed to something else? If not, prefer strategy 3.
2. Would adding the children to an existing base-table collection pollute an existing access pattern? If yes, move them to an index.
3. Is eventual consistency acceptable for this read? Global secondary indexes are eventually consistent.

**Costs:**
- Additional write throughput and storage for the index.
- Eventually consistent reads.
- More indexing attributes to maintain on each item.

### 5. Composite sort key for hierarchical data

**Problem it solves:** more than two levels of hierarchy, with access patterns at several levels, without adding a secondary index per level.

**Design:** the partition key is the top level; the sort key concatenates the remaining levels in order, separated by `#`. ("Composite sort key" means several values packed into the sort key, not the composite primary key itself.)

Example: store locations searchable by country, state, city, or zip code.

| PK (Country) | SK (`<State>#<City>#<ZipCode>`) | Attributes |
|---|---|---|
| `USA` | `NE#OMAHA#68118` | StoreNumber, Address, ... |
| `USA` | `NY#NEW YORK CITY#10001` | ... |
| `USA` | `NY#NEW YORK CITY#10019` | ... |
| `FRANCE` | `ILE-DE-FRANCE#PARIS#75001` | ... |

(Row values are illustrative. If several stores can share a zip code, the key needs an additional unique element such as a store number; the book's description of this table does not go into that.)

| Access pattern | Query key condition |
|---|---|
| All locations in a country | `PK = <Country>` |
| ... in a country and state | `PK = <Country> AND begins_with(SK, "<State>#")` |
| ... in a country, state, and city | `PK = <Country> AND begins_with(SK, "<State>#<City>")` |
| ... in a country, state, city, and zip | `PK = <Country> AND begins_with(SK, "<State>#<City>#<ZipCode>")` |

Four levels of search granularity from the primary key alone.

**Deciding questions.** It fits best when both are true:

1. There are many levels of hierarchy (more than two) and access patterns at different levels.
2. A search at a given level should return **everything beneath that level**, not only the items at that level.

Counter-example: in the Organization -> User -> Ticket model, "find all Users" must not also return every Ticket under each User. A composite sort key would return all of those descendants, so the previous two strategies fit better there.

**Costs:**
- Queries must follow the hierarchy from the top; you cannot skip a level (no "all locations in a city" without country and state).
- Every level value must be known at write time and normalized consistently, and values must not contain the delimiter.
- The top-level value is the partition key, so a dominant top-level value concentrates data and traffic in one partition.

---

## Many-to-many strategies

The core problem: both sides of the relationship usually need to be queried (a student's classes and a class's students). Pre-joining for one direction does not give you the other, which makes this one of the harder areas for DynamoDB. A relational join table read with joins is not available.

### 1. Shallow duplication

**Problem it solves:** one side needs to list its related entities, but only with minimal information about each (a name or an ID), with a link to the full entity for anyone who wants details.

**Design:** store a list of the small, stable facts about the related entities directly on the item.

Example: Students and Classes, where the class page shows the roster by name.

| PK | SK | Attributes |
|---|---|---|
| `STUDENT#<StudentName>` | `STUDENT#<StudentName>` | full student record |
| `STUDENT#<StudentName>` | `STUDENT#<StudentName>` | full student record |
| `CLASS#<ClassName>` | `CLASS#<ClassName>` | class details, `Students: ["Student A", "Student B", ...]` |

(Key templates are illustrative; the book's figure shows three Student items and two Class items, each Class carrying a `Students` list attribute.)

"Fetch a class and all students in the class" becomes a single GetItem.

**Deciding questions.** Both must be true:

1. **The number of related entities is limited.** The list lives on one item, bounded by the 400KB item limit. A high or unbounded count rules it out (same reasoning as the complex attribute strategy).
2. **The duplicated information is immutable**, or close to it. A student's name qualifies. A GPA or graduation date does not: frequently changing copies mean hunting down every reference on each change, with extra write capacity and integrity risk.

**Costs:**
- **It solves only one side.** You still have to model "fetch a student and all the student's classes". Having removed one direction, treat the other as a one-to-many problem and apply a strategy from the previous section.
- Only the shallow fields are available without a further read of the full entity.
- Membership changes rewrite the parent item's list.

### 2. Adjacency list

**Problem it solves:** both directions of the relationship need a single-request read, and the relationship itself carries data.

**Design:** store each top-level entity as an item, and store each relationship as its own item. Place the relationship item in the collection of one entity in the base table, and use a secondary index to place it in the collection of the other.

Example: Movies, Actors, and Roles.

| Entity | PK | SK |
|---|---|---|
| Movie | `MOVIE#<MovieName>` | `MOVIE#<MovieName>` |
| Actor | `ACTOR#<ActorName>` | `ACTOR#<ActorName>` |
| Role | `MOVIE#<MovieName>` | `ACTOR#<ActorName>` |

Base table:

| PK | SK | Item |
|---|---|---|
| `MOVIE#Toy Story` | `ACTOR#Tom Hanks` | Role (character name, ...) |
| `MOVIE#Toy Story` | `ACTOR#Tim Allen` | Role |
| `MOVIE#Toy Story` | `MOVIE#Toy Story` | Movie (box office, score, ...) |
| `ACTOR#Tom Hanks` | `ACTOR#Tom Hanks` | Actor (upvotes, ...) |

Inverted index (partition key = `SK`, sort key = `PK`):

| SK (index partition key) | PK (index sort key) | Item |
|---|---|---|
| `ACTOR#Tom Hanks` | `ACTOR#Tom Hanks` | Actor |
| `ACTOR#Tom Hanks` | `MOVIE#Cast Away` | Role |
| `ACTOR#Tom Hanks` | `MOVIE#Toy Story` | Role |

| Access pattern | Operation |
|---|---|
| Movie and the roles in it | Query base table, `PK = MOVIE#<MovieName>` |
| Actor and all of the actor's roles | Query the index, `SK = ACTOR#<ActorName>` |

**Why it works well.** Mutable facts stay on the top-level items (a movie's box office total or rating, an actor's upvote count) and exist exactly once. The Role items are the only things that appear in both collections, and they do not change after the fact. You can update a Movie or Actor without touching any Role.

**Inverted index vs dedicated attributes.** Flipping `PK` and `SK` for the index affects every item in the table. If other item types should not be flipped (it would not produce the access patterns they need), write `GSI1PK` / `GSI1SK` attributes holding the flipped values only on the items in this relationship and build `GSI1` on those. This also follows the rule of not reusing attributes across indexes (see `modeling-process.md`).

**Deciding questions:**

1. **Is the information about the relationship immutable or rarely changing?** This is the main fit criterion.
2. Does each direction need the relationship's data plus that side's own top-level item, rather than full details of the entities on the far side? Each query returns one top-level item and its relationship items. Anything about the far-side entities must be copied onto the relationship item (so it must be stable) or fetched separately.

**Costs:**
- An extra item type and an extra write per relationship.
- A secondary index, with its write cost and eventual consistency.
- Any far-side detail duplicated onto relationship items reintroduces the update problem; if that detail is highly mutable, fall back to strategy 4.

### 3. Materialized graph

**Problem it solves:** highly connected data with many kinds of relationships, where you need to find a node type or value and everything related to it.

**Design:**

1. Model each **node** (person, place, thing) as an item collection in the base table, split into several items: one item per relationship or facet (an edge) rather than one item holding every attribute.
2. Add a secondary index that regroups those edge items by the thing they point to, so all nodes sharing a relationship value land in one index partition.

Example: a knowledge graph of people. The book's figures did not survive extraction, so the attribute names below are a reconstruction from the prose; only the node ID `156`, the wedding date grouping, and the `JOB|Attorney` grouping are from the source.

Base table, partitioned by node:

| NodeId (PK) | Edge / item type (SK) | Data (indexed) | Notes |
|---|---|---|---|
| `156` | Person | name | the node itself |
| `156` | Married | `DATE\|2011-05-28` | edge to a date |
| `156` | Job | `JOB\|Attorney` | edge to a job |
| `<wife's NodeId>` | Married | `DATE\|2011-05-28` | |
| `<another NodeId>` | Job | `JOB\|Attorney` | |

Secondary index, partitioned by the edge target:

| Index partition | Items in it |
|---|---|
| `DATE\|2011-05-28` | the two Married edges, one per spouse; other events on that date would land here too |
| `JOB\|Attorney` | the Job edges of every person who is an attorney |

Each edge item carries its `NodeId`, so after reading an index partition you can query the base table by node ID to rebuild the full node.

**Deciding questions:**

1. Is the data genuinely graph-shaped: many relationship types, heavily interconnected, with "find all entities related to X" as the main read?
2. Is a follow-up request to rebuild full nodes acceptable?

**Costs:**
- Entities are fragmented across items, so reading a whole node is a Query, not a GetItem.
- Reads through the index return edges, and full node details need follow-up requests.
- Niche: the book gives no full worked example. Prefer the adjacency list unless the data is clearly a graph.

### 4. Normalization and multiple requests

**Problem it solves:** the relationship's display data is highly mutable and heavily duplicated, so every duplication strategy would cause unacceptable write amplification. This is the fallback.

**Why duplication fails here.** In a social network, the "people I follow" screen shows each followed user's display name and profile description, both of which change. If each follow relationship item stored those fields, a profile edit by a user with thousands or millions of followers would require rewriting that many items.

**Design:** keep relationship items sparse (identifiers and immutable facts only) and fetch the authoritative entity items in a second step.

| Entity | PK | SK |
|---|---|---|
| User | `USER#<Username>` | `USER#<Username>` |
| Following | `USER#<Username>` | `FOLLOWING#<Username>` |

| PK | SK | Attributes |
|---|---|---|
| `USER#alexdebrie` | `USER#alexdebrie` | DisplayName, Profile, ... |
| `USER#alexdebrie` | `FOLLOWING#paulchinjr` | followed username, follow timestamp |
| `USER#alexdebrie` | `FOLLOWING#gillianarmstrong` | followed username, follow timestamp |
| `USER#paulchinjr` | `USER#paulchinjr` | DisplayName, Profile, ... |
| `USER#gillianarmstrong` | `USER#gillianarmstrong` | DisplayName, Profile, ... |

Read path for "users that X follows":

1. **Query** `PK = USER#<Username>` to get the User item and the first page of Following items.
2. **BatchGetItem** the User items for the usernames found, to get current display names and profiles.

**Variant: shallow copy now, authoritative read later.** A shopping cart duplicates some product details (size, price, item number) onto the cart entry when the item is added, which is enough to show a cart count and an estimated total. At checkout the application goes back to the authoritative product items for the current price and stock. Use this when stale data is fine for display but not for the transaction.

**Deciding questions:**

1. Is the data needed from the related entities highly mutable?
2. Is it duplicated widely (high fan-out), so that propagating each change would be a burst of writes?
3. If both are yes, accept the extra read. If only display freshness matters at one specific moment (checkout), combine a shallow copy with a late authoritative read.

**Costs:**
- More than one request per read, serial, with the latency that implies. This is the thing single-table design normally avoids; here there is no better option.
- Paging: each page of relationship items needs its own batch fetch.
- The reverse direction (who follows X) is not covered by this key design alone and needs its own solution, such as an index over the relationship items.

---

## Selection tables

### One-to-many

| Situation | Strategy | Check before committing |
|---|---|---|
| Children are bounded in number and never accessed directly, only through the parent | Complex attribute (list or map on the parent) | No access pattern on the nested values; a cap you can enforce well under 400KB |
| Reads of the child need a few parent facts that are immutable or change rarely | Duplicate parent data onto children | Change frequency and number of copies; a plan to update every copy |
| Need parent and children together, plus children alone and individual items (most common case) | Composite primary key + Query | Base table key is free for this; client knows the parent ID when reading a child |
| Same need, but the primary key is taken (uniqueness, another level of hierarchy), or adding children to the base collection would pollute an existing pattern | Secondary index + Query | Eventual consistency is acceptable; sort key prefixes place the parent at the right end of the collection |
| Deep hierarchy (more than two levels) searched at several levels, where each level should return everything beneath it | Composite sort key | Queries always start from the top level; you never need a level's items without its descendants |

The book's own summary, for cross-reference:

| Strategy | Notes | Where it appears |
|---|---|---|
| Denormalize + complex attribute | Good when nested objects are bounded and are not accessed directly | Session store example (ch. 18) |
| Denormalize + duplicate | Good when duplicated data is immutable or infrequently changing | Movie roles table |
| Primary key + Query API | Most common. Good for multiple access patterns on both the parent and related entities | E-commerce (ch. 19), Big Time Deals (ch. 20) |
| Secondary index + Query API | Similar to primary key strategy. Good when primary key is needed for something else | E-commerce (ch. 19), Big Time Deals (ch. 20) |
| Composite sort key | Good for deeply nested hierarchies where you need to search through multiple levels | Big Time Deals (ch. 20) |

### Many-to-many

| Situation | Strategy | Check before committing |
|---|---|---|
| One side only needs minimal, stable information about its related entities, and the related set is small | Shallow duplication | Bounded count; duplicated fields immutable; other direction still needs its own strategy |
| Both directions need a one-request read, and the relationship's own data is immutable or rarely changes | Adjacency list (relationship item + inverted index or `GSI1`) | Mutable data stays on the top-level items only; decide between flipping `PK`/`SK` and dedicated GSI attributes |
| Highly interconnected data with many relationship types; main read is "everything related to X" | Materialized graph | Data is truly graph-shaped; follow-up reads to rebuild nodes are acceptable |
| Data shown through the relationship is highly mutable and widely duplicated | Normalization + multiple requests (Query, then BatchGetItem) | Latency of two requests is acceptable; consider a shallow copy for display with an authoritative read at the critical moment |

The book's own summary, for cross-reference:

| Strategy | Notes | Where it appears |
|---|---|---|
| Shallow duplication | Good when a parent entity only needs minimal information about related entities | Big Time Deals (ch. 20) |
| Adjacency list | Good when information about the relationship is immutable or infrequently changing | GitHub (ch. 21) |
| Materialized graph | Good for highly interconnected data with a variety of relationships | Knowledge graph |
| Normalization & multiple requests | Fallback option for when you have highly mutable data contained in the relationship | Social network recommendations |

### Quick decision order

For a one-to-many relationship:

1. Bounded and only read through the parent? Complex attribute.
2. Only need a few stable parent facts on the child? Duplicate them.
3. Otherwise put parent and children in one item collection on the base table.
4. Base table key unavailable or the collection would get polluted? Build the collection in a GSI.
5. Many levels, each read wanting all descendants? Composite sort key.

For a many-to-many relationship:

1. Does one side only need a short list of stable facts? Shallow duplication for that side, then a one-to-many strategy for the other.
2. Is the relationship data stable? Adjacency list.
3. Is the data a real graph with many relationship types? Materialized graph.
4. Is the related data volatile and fanned out widely? Normalize and make two requests.
