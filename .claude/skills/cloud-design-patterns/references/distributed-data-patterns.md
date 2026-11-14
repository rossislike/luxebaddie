# Distributed Data Patterns: Saga, Transactional Outbox, Event Sourcing

With database-per-service, a single business transaction can span several data stores. ACID across them is not available, so these patterns restore integrity, atomicity of "write and notify", and history in other ways.

- **Saga:** keep multi-service business transactions consistent through local transactions plus compensations.
- **Transactional outbox:** make "update my DB" and "publish my event" atomic.
- **Event sourcing:** make the event log the source of truth.

They compose: each saga step is a local transaction that must publish an event (outbox), and the events can be persisted as the system's history (event sourcing).

---

## Why not two-phase commit?

A transaction is a unit of work where all steps run or none do (ACID: atomicity, consistency, isolation, durability). Relational databases coordinate distributed commits with **two-phase commit (2PC)**:

- **Prepare:** the coordinator asks participants to promise to commit or roll back.
- **Commit:** the coordinator tells participants to commit; if anyone could not promise, everything rolls back.

With database-per-service, 2PC is not an option: the transaction spans different databases and there is no single controller to coordinate it. Many NoSQL stores do not support it at all. A saga is the alternative.

---

## Saga

### Concept

A saga is a **sequence of local transactions**. Each one updates its own database and triggers the next. If one fails, the saga runs **compensating transactions** that semantically undo earlier steps.

- **Continuation principle (forward recovery):** retry the failed step and continue.
- **Compensation principle (backward recovery):** undo completed steps and return to the prior state.

Example: buying a book is *create order -> update inventory -> take payment -> ship*. Choose recovery direction by failure type:

| Failure type | Example | Recovery |
|---|---|---|
| **Platform-level** | Infrastructure glitch makes a step fail | **Forward**: retry the local transaction and continue |
| **Application-level** | Payment is invalid | **Backward**: run compensations to restore inventory and cancel the order |

Notation used below: steps T1 (order), T2 (inventory), T3 (payment); compensations undo them in reverse.

### Choreography vs orchestration

| | Choreography | Orchestration |
|---|---|---|
| Control | Participants subscribe to each other's events and react | A central orchestrator sends commands and decides next steps |
| Best for | Few participants, simple flow | Many participants, complex flow |
| Coupling | Loose, but dependencies are implicit and spread out | Participants are loosely coupled to each other; flow logic is centralized |
| Single point of failure | None | The orchestrator (mitigate with a managed, multi-AZ engine like Step Functions) |
| Timeouts, retries, resilience | Must be implemented in every participant | Implemented once at the orchestrator |
| Observability | Hard to get end-to-end view | Natural: the orchestrator knows the state |
| Risks | Cyclic dependencies, possible deadlocks, hard to trace as it grows | Orchestrator becomes a "god service" if it absorbs business logic |

Rule of thumb: start with choreography for 2 to 3 participants and a linear flow; move to orchestration as soon as the dependency graph is hard to draw from memory.

### Shared issues and considerations

| Issue | Guidance |
|---|---|
| **Complexity** | Compensations and retries add code and maintenance. Design each step's compensation at the same time as the step. |
| **Eventual consistency** | Steps commit one after another. Set business expectations, or reconsider and use a strongly consistent store if truly required. |
| **Idempotency** | Participants must tolerate repeated execution caused by crashes, redelivery, and orchestrator retries. |
| **Transaction isolation** | Sagas lack the "I" in ACID. Concurrent sagas can read each other's intermediate state and act on stale data. Use **semantic locking**: mark records as in-flight (for example `status = PENDING`) so other sagas treat them accordingly until the saga completes or compensates. |
| **Observability** | Detailed logging and tracing are essential; debugging gets hard as participants grow. Use correlation IDs across all steps. |
| **Latency** | Compensations add to response time for long sagas. Avoid synchronous calls inside sagas where possible. |
| **Dual writes** | Each participant must atomically update its DB and publish an event. Use the transactional outbox. |
| **Preserving events** (choreography) | Persist events in order for audit, debugging, and replay; event sourcing fits. |

### Saga choreography

**Use when:**
- Distributed transactions span multiple data stores and need integrity.
- The data store lacks 2PC, you must update multiple tables in one logical transaction, and building 2PC in the app would be complex.
- A central controller would be an unacceptable single point of failure.
- Participants are independent, loosely coupled services.
- Communication crosses bounded contexts.

**Flow (order, inventory, payment):**
1. Order service runs T1: atomically updates its DB and publishes **Order placed**.
2. Inventory service, subscribed to order events, runs T2: updates inventory and publishes **Inventory updated**.
3. Payment service, subscribed to inventory events, runs T3: records payment and publishes **Payment processed**.
4. If payment fails, the payment service runs its compensation and publishes **Payment failed**.
5. Inventory service reacts by reverting inventory and publishes **Inventory reverted**.
6. Order service reacts by removing (cancelling) the order.

**On AWS with Amazon EventBridge:**
- Services are Lambda functions.
- Three custom event buses: **Orders**, **Inventory**, **Payment**.
- Rules on each bus match events and invoke the next participant.
- Success: order -> Orders bus -> rule starts inventory -> Inventory bus -> rule starts payment -> Payment bus -> rule notifies listener of **Payment processed**.
- Failure: Payment rules route the failure to inventory (revert), which emits **Inventory reverted**, whose rule starts order removal.

### Saga orchestration

**Use when:**
- Distributed transactions span multiple data stores and need integrity.
- The store lacks 2PC and implementing it would be complex.
- You use NoSQL databases without ACID transactions and must update multiple tables in one logical transaction.
- There are many participants, or you need centralized timeouts, retries, and monitoring.

**Flow:** The orchestrator knows the steps and runs them in order: T1, T2, T3. If T3 (payment) fails, it runs compensations for completed steps in reverse.

**On AWS with Step Functions (Standard workflow):**
- API Gateway invokes a Lambda function for preprocessing, which starts the state machine (or API Gateway starts it directly if no preprocessing is needed).
- Success path: **Place Order -> Update Inventory -> Make Payment -> Success**.
- Compensation path: **Revert Payment -> Revert Inventory -> Remove Order -> Fail**. Failing at Update Inventory runs Revert Inventory and Remove Order, then Fail.
- Step Functions is multi-AZ with built-in fault tolerance, which mitigates the orchestrator single-point-of-failure concern.

CDK (C#) sketch from the guide:

```csharp
var success = new Succeed(this, "SuccessState");
var fail    = new Fail(this, "Fail");

LambdaInvoke Task(string name, IFunction fn) => new LambdaInvoke(this, name, new LambdaInvokeProps {
    LambdaFunction = fn, RetryOnServiceExceptions = false, PayloadResponseOnly = true });

var placeOrder      = Task("Place Order", placeOrderLambda);
var updateInventory = Task("Update Inventory", updateInventoryLambda);
var makePayment     = Task("Make Payment", makePaymentLambda);

// Compensations chain in reverse order and end in Fail.
var removeOrder     = Task("Remove Order", removeOrderLambda).Next(fail);
var revertInventory = Task("Revert Inventory", revertInventoryLambda).Next(removeOrder);
var revertPayment   = Task("Revert Payment", revertPaymentLambda).Next(revertInventory);
var wait            = new Wait(this, "Wait state", new WaitProps {
                          Time = WaitTime.Duration(Duration.Seconds(30)) }).Next(revertInventory);

var definition = placeOrder.Next(new Choice(this, "Is order placed")
    .When(Condition.StringEquals("$.Status", "ORDER_PLACED"), updateInventory
        .Next(new Choice(this, "Is inventory updated")
            .When(Condition.StringEquals("$.Status", "INVENTORY_UPDATED"), makePayment
                .Next(new Choice(this, "Is payment success")
                    .When(Condition.StringEquals("$.Status", "PAYMENT_COMPLETED"), success)
                    .When(Condition.StringEquals("$.Status", "ERROR"), revertPayment)))
            .When(Condition.StringEquals("$.Status", "ERROR"), wait)))
    .When(Condition.StringEquals("$.Status", "ERROR"), fail));

new StateMachine(this, "DistributedTransactionOrchestrator", new StateMachineProps {
    StateMachineType = StateMachineType.STANDARD,
    TracingEnabled = true,
    Definition = definition });
```

Improvement over the sample: add `Catch` blocks on each task so that unexpected exceptions (not just a returned `ERROR` status) also route to the right compensation, and add retries with backoff for platform-level failures (forward recovery) before compensating.

Full sample: https://github.com/aws-samples/saga-orchestration-netcore-blog

### Designing compensations

- A compensation is a **semantic undo**, not a rollback: refund a charge, release a reservation, cancel an order. The original action stays in history.
- Compensations must be **idempotent and retryable**; they must eventually succeed. If one cannot, escalate to a human (alert, manual queue).
- Order steps so that **hard-to-compensate actions come last** (for example, irreversible external calls like shipping or emailing a customer).
- Distinguish **business errors** (compensate) from **technical errors** (retry first).

---

## Transactional Outbox

### Intent

Solve the **dual write** problem: one operation writes to the database and also sends a message or event. If the two are separate, a failure in one leaves the system inconsistent.

### The failure modes

- DB update succeeds, event fails: downstream services never learn about the change.
- DB update fails (or rolls back), event is sent: downstream acts on something that never happened (for example payment processed for a flight booking that did not commit).
- Service crashes after commit but before publish: event lost.

### When to use

- An event-driven application where a DB update must trigger a notification.
- You need atomicity across an operation that involves two systems.
- You are implementing event sourcing.

### Issues and considerations

| Issue | Guidance |
|---|---|
| **Duplicate messages** | The relay may send an event more than once. Make consumers idempotent by tracking processed message IDs. |
| **Order of notification** | Publish in the same order the DB was updated. Critical for event sourcing and point-in-time recovery. |
| **Transaction rollback** | Never send an event for a rolled-back transaction. |
| **Service-level transactions** | If the business transaction spans several services' stores, use a saga; the outbox only makes each local step atomic. |

### Option 1: Outbox table (relational DB)

1. In **one local transaction**, write the business row (flight) and an outbox row (event type, payload, timestamp, sequence number).
2. A separate **relay / event processing service** reads committed outbox rows in order, publishes them (for example to SQS), and deletes or marks them once the broker acknowledges.
3. If either insert fails, the whole transaction rolls back; nothing is published.

```java
@PostMapping("/flights")
@Transactional
public Flight createFlight(@Valid @RequestBody Flight flight) {
    Flight saved = flightRepository.save(flight);
    JsonNode payload = objectMapper.convertValue(flight, JsonNode.class);
    outboxRepository.save(new FlightOutbox(
        flight.getId().toString(), FlightOutbox.EventType.FLIGHT_BOOKED, payload));
    return saved;
}
```

```java
@Scheduled(fixedDelayString = "${sqs.polling_ms}")
public void forwardEventsToSQS() {
    List<FlightOutbox> batch =
        outboxRepository.findAllByOrderByIdAsc(Pageable.ofSize(batchSize)).toList();
    if (batch.isEmpty()) return;

    List<SendMessageBatchRequestEntry> entries = batch.stream().map(e ->
        SendMessageBatchRequestEntry.builder()
            .id(e.getId().toString())
            .messageGroupId(e.getAggregateId())            // FIFO ordering per aggregate
            .messageDeduplicationId(e.getId().toString())  // FIFO dedup
            .messageBody(e.getPayload().toString())
            .build()).toList();

    sqsClient.sendMessageBatch(SendMessageBatchRequest.builder()
        .queueUrl(queueUrl).entries(entries).build());
    outboxRepository.deleteAllInBatch(batch);
}
```

Caveat in the sample: `sendMessageBatch` can partially fail (it returns per-entry results). Delete only entries that succeeded, or the failed ones are lost. If the process crashes between send and delete, rows are resent: that is the expected at-least-once behavior, which is why consumers must be idempotent. With multiple relay instances, use row locking (`SELECT ... FOR UPDATE SKIP LOCKED`) or a single leader.

Broker choice: **SQS standard** queues guarantee at-least-once delivery (may duplicate, best-effort order). **SQS FIFO** queues give ordering per message group and deduplication within a window.

### Option 2: Change data capture (CDC)

Some databases publish item-level changes. The change stream *is* the outbox, so no extra table is needed; store the event in an attribute of the same item if needed.

- **DynamoDB Streams** (or Kinesis Data Streams for DynamoDB) capture a time-ordered sequence of item changes.
- A Lambda function (or Spring Cloud Stream consumer) reads the stream and publishes to SQS.
- Add timestamp and sequence number attributes to items for robustness.

```typescript
// CDK: route all DynamoDB table changes to a Kinesis stream
const cdcStream = new kinesis.Stream(this, 'flightsCDCStream', { streamName: 'flightsCDCStream' });
const flightTable = new dynamodb.Table(this, 'flight', {
  tableName: 'flight',
  kinesisStream: cdcStream,
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
});
```

Other CDC sources: PostgreSQL logical replication / MySQL binlog via Debezium or AWS DMS.

Outbox table vs CDC: the table gives you an explicit, domain-shaped event and works on any relational DB; CDC removes the extra write and table but emits row-shaped changes that you may need to translate into domain events.

Full sample: https://github.com/aws-samples/transactional-outbox-pattern

---

## Event Sourcing

### Intent

Store the **events that cause state changes**, not just current state. This keeps a complete history of changes and enables auditability, traceability, and analysis of past states.

### Concepts

- **Command:** a request to a service to change state (for example *Book ride*). The service validates it against current state.
- **Event:** emitted when a command succeeds; a fact about what happened (for example *Ride booked*), past tense, immutable.
- **Event store:** immutable, append-only, chronologically ordered log. The single source of truth.
- **Replay processor:** applies events in order to rebuild current state or any point-in-time state.

Ways to derive current state:
1. **Aggregate related events** into a read store (commonly with CQRS).
2. **Materialized views** that summarize event data.
3. **Replay** events to regenerate state.

The event store publishes events, which are filtered and routed to processors (view builders, payment, analytics). Different processors can build different stores from the same log (**polyglot persistence**).

### When to use

- An immutable history of events is required for tracking.
- You need polyglot projections from one source of truth.
- Point-in-time reconstruction of state is needed.
- You do not need to store state long-term but want to rebuild it on demand.
- Read and write volumes differ (for example write-heavy without real-time reads).
- You need CDC to analyze performance and metrics.
- Audit data for every event is required for reporting and compliance.
- You want what-if analysis by inserting, updating, or deleting events during replay.

### Issues and considerations

| Issue | Guidance |
|---|---|
| **Optimistic concurrency** | Concurrent writers can create conflicting events. Version events (expected version per aggregate) or timestamp them, and reject appends with a stale expected version. |
| **Complexity** | Requires shifting from CRUD to event thinking. Replay must be idempotent. Storage, backups, and snapshots add work. |
| **Eventual consistency** | Projections (CQRS read models, materialized views) lag the log. |
| **Querying** | Querying raw logs is slower and harder than a normal DB, especially for reporting. Pair with CQRS. |
| **Store size and cost** | The log grows continuously. Archive older events to low-cost storage periodically. |
| **Store scalability** | Must handle high write and read volume. Use a store with shards or partitions. |
| **Efficiency** | Choose a store optimized for your volume and query patterns; index for reconstruction; consider purpose-built event store databases. |
| **Snapshots** | Back up state at regular intervals so replay starts from the last snapshot, not from the beginning. Snapshot frequency is driven by your **RPO** (maximum acceptable data loss window). |
| **Time sensitivity** | Order matters, and network latency can reorder. Use FIFO queues to carry events to the store. |
| **Replay performance** | Replaying many events (especially from archive) is slow; optimize and snapshot. |
| **External system updates** | Replay must not re-send updates to external systems that do not expect them. Gate with feature flags. |
| **External system queries** | If an external call's result depends on when it was made, store the response so replay uses the original value. |
| **Event versioning** | Schemas evolve. Include a version field and handle each version during replay (upcasting) for backward and forward compatibility. |

### AWS reference architecture (ride hailing)

Event store: **Amazon Kinesis Data Streams** (alternatives: Amazon EventBridge, Amazon MSK). Archive to **Amazon S3** for durability, audit, and compliance.

1. Mobile client sends a ride booking request to **API Gateway**.
2. **Ride service** Lambda function validates, transforms, and enriches the request and publishes to Kinesis. (API Gateway can write to Kinesis directly, but complex domains usually need enrichment first.)
3. Kinesis events are stored in **S3** for audit history.
4. **Ride event processor** Lambda function builds a materialized view in **Aurora**.
5. Completed-ride events are filtered and sent to an external **payment gateway**; payment completion emits another event back to Kinesis.
6. When the ride completes, ride events are **replayed** to the Ride service to build route and ride history.
7. **Ride data service** reads from Aurora.

Blog: "New for AWS Lambda: SQS FIFO as an event source".

### Event sourcing checklist

- Events are named in the past tense, immutable, versioned, and carry an aggregate ID and sequence number.
- Appends use optimistic concurrency on the aggregate's expected version.
- Snapshots exist and their frequency is tied to RPO.
- There is an archive policy for old events.
- Replays are idempotent and suppress external side effects.
- Read models are rebuildable from scratch.
- Publishing from the store is atomic with the append (the store itself publishes, or use an outbox).
