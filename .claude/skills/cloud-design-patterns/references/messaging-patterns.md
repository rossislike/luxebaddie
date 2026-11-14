# Messaging Patterns: Publish-Subscribe and Scatter-Gather

Both patterns decouple services through asynchronous messaging. Pub-sub is **one-to-many, fire-and-forget**. Scatter-gather is **one-to-many, then many-to-one**: it fans out and then waits to aggregate answers.

---

## Publish-Subscribe (pub-sub)

### Intent

Decouple a message sender (publisher) from interested receivers (subscribers) via an intermediary: a message broker or router. Publishers offload delivery to the messaging infrastructure and focus on their own processing, improving scalability and responsiveness.

### Motivation

Components need to tell other components when things happen. Pub-sub separates concerns: applications focus on core capabilities while the infrastructure handles routing and reliable delivery. Publishers do not need to know who the subscribers are.

### When to use

- One message should start several different workflows in parallel.
- You are broadcasting to multiple subscribers and do not need real-time responses.
- The system tolerates eventual consistency.
- Producers and consumers use different languages, protocols, or platforms.

### When not to use

- You need a synchronous response or bidirectional conversation. Pub-sub is **unidirectional**; use request-reply instead.
- Consumers need strong consistency with the producer's state immediately.

### How the broker works

- An **input channel** where the producer publishes events packaged as messages in a defined format.
- An **output channel per subscription**. A subscription is a consumer's connection listening for messages from a specific input channel.
- When an event is published, the broker **copies** it from the input channel to every output channel.
- After delivery the message is typically removed from the broker: it cannot be replayed and new subscribers do not see past events (unless the infrastructure offers archive and replay).

### Issues and considerations

| Issue | Guidance |
|---|---|
| **Subscriber availability** | Publishers do not know if anyone is listening. Messages are transient and can be dropped if subscribers are unavailable. Put a durable queue behind each subscriber (for example SNS to SQS fan-out). |
| **Delivery guarantee** | Generally not guaranteed to every subscriber type. Some services (for example SNS FIFO to SQS FIFO) offer exactly-once to some subscriber types. |
| **Time to live** | Messages expire if not processed in time. Queue them to persist beyond the TTL. |
| **Message relevancy** | Producers can embed a "relevant until" time; consumers check it and discard stale messages. |
| **Eventual consistency** | Delay between publish and consume. A problem when strong consistency or near-real-time interaction is required. |
| **Ordering** | Not guaranteed by default. Use FIFO topics (SNS FIFO) when consumers need order. |
| **Duplication** | Duplicates happen. Consumers must be idempotent, or use FIFO topics for exactly-once. |
| **Filtering** | Subscribers usually want a subset. Offer topics or content-based filters (SNS subscription filter policies, EventBridge rules). |
| **Replay** | Depends on the infrastructure (EventBridge archive and replay, Kinesis retention); otherwise build it. |
| **Dead-letter queues** | Like a postal dead-letter office: a DLQ holds messages that cannot be delivered to a subscribed endpoint. Monitor and redrive. |

### AWS implementations

**Amazon SNS.** Fully managed pub-sub for application-to-application and application-to-person (SMS, email, push).
- **Standard topics:** effectively unlimited throughput; best-effort ordering and deduplication.
- **FIFO topics:** strict ordering and deduplication; throughput limits per topic (the guide cites 300 messages/second or 10 MB/second; check current quotas, as AWS has raised FIFO limits over time).
- Example: after a payment, the Payments Lambda function publishes to a Payments SNS topic with three subscribers; each receives a copy.

**Amazon EventBridge.** Use for more complex routing from many producers across protocols, content-based routing and filtering, sequencing, splitting or aggregation, and direct or fan-out subscriptions. Subscribers are defined as **rules** on an event bus. Example: the Payments Lambda function puts an event on the default bus using a custom schema; three rules route it to three different targets.

Rule of thumb: **SNS** for simple, high-throughput fan-out to known endpoints; **EventBridge** for content-based routing, many event sources, SaaS integrations, schema registry, archive and replay. **SQS** behind each subscriber for durability and back-pressure.

Workshops: "Building event-driven architectures on AWS"; "Send fanout event notifications with Amazon SNS and Amazon SQS".
Blogs: "Choosing between messaging services for serverless applications"; "Designing durable serverless applications with DLQs for Amazon SNS, Amazon SQS, AWS Lambda"; "Simplify your Pub/Sub messaging with Amazon SNS message filtering".

### Subscriber checklist

- Idempotent handler (dedup on message ID or business key).
- Durable queue in front of the handler.
- DLQ with alarms and a redrive process.
- Filter policy so it receives only what it needs.
- Handles out-of-order arrival, or uses FIFO.
- Checks message relevancy or expiry when applicable.

---

## Scatter-Gather

### Intent

A message routing pattern that broadcasts similar or related requests to multiple recipients and aggregates their responses into one message using an **aggregator**. Achieves parallelism, reduces latency, and handles asynchronous communication. Easy to implement synchronously; more powerful as asynchronous message routing, with or without a messaging service.

### Two phases

- **Scatter:** process the request and send it to multiple recipients in parallel, continuing without waiting for immediate responses.
- **Gather:** collect responses, filter or combine them into one unified response, or pick the best one.

### When to use

- **Aggregating data from many APIs** into one accurate response (for example quotes from multiple external booking partners).
- **The same request must go to many recipients at once** to complete a transaction (for example checking product availability across inventories in parallel).
- **Reliability and load distribution**: if one recipient fails or is overloaded, others still respond.
- **Complex queries across multiple data sources**: scatter the query, gather partial results, combine.
- **Map-reduce style processing** across sharded or replicated endpoints.
- **Write-heavy key-value workloads** spread across a partition key space; the aggregator queries each shard and merges results.

### Issues and considerations

| Issue | Guidance |
|---|---|
| **Fault tolerance** | Recipients will fail. Use redundancy, replication, and failure detection. |
| **Scale-out limits** | More recipients means more network overhead and latency, eroding the benefit of parallelism. |
| **Response-time bottleneck** | If you wait for everyone, the slowest recipient sets the latency. |
| **Partial responses** | Some recipients time out. Tell the client the response is incomplete; a UI can show aggregation status. |
| **Data consistency** | Merging across recipients needs synchronization and conflict-resolution rules so the result is accurate. |

### Two scatter mechanisms

**Scatter by distribution.** The controller knows the recipient list.
- The root controller splits the request into independent tasks and assigns them to recipients (processes, containers, Lambda functions) that work in parallel.
- Recipients send partial results to an aggregator, which combines them and returns the final result.
- The controller can set a timeout and ignore slow responses, and can redistribute work from a slow node to another.
- Deploy each recipient with multiple instances for resilience. The aggregator deduplicates. The controller can also be the aggregator.

**Scatter by auction.** The controller does not know the recipients, or they are loosely coupled.
- Recipients subscribe to a topic (pub-sub); the controller publishes the request.
- Recipients publish results to a response queue.
- An aggregator collects responses and correlates them by a **unique request ID**.
- Recipients can subscribe or unsubscribe at any time, so adding a provider requires no controller change.

### Example: flight search (scatter by auction)

1. Flight booking service (controller) takes search criteria and publishes the request to a topic.
2. The controller assigns a unique ID to the request group.
3. The client keeps that ID to fetch results later.
4. Search microservices (non-stop flights, flights with stops, partner airlines) receive the request.
5. Each processes it and writes seat availability to a response queue.
6. The aggregator collects responses into a temporary store, groups them by unique ID, builds one unified response, and returns it to the client.

### AWS implementations

**Scatter by distribution: file processing**
- Root controller is a data file processor on **Amazon ECS** that splits input into separate **S3** locations and starts a **Step Functions** workflow.
- A **Parallel** state (or a Map state for dynamic fan-out) processes files concurrently and waits for all branches.
- A **Lambda** aggregator merges results and writes them back to S3.

**Scatter by auction: flight search**
- **SNS** topic is the publish-subscribe channel.
- Recipient microservices on **EKS** or **ECS** subscribe to the topic.
- Responses go to an **SQS** response queue; the aggregator collates them into a temporary store.
- The controller records the request ID in **Aurora**.
- A flight results service (Lambda, ECS, or EKS) groups by ID and returns the unified response.
- To add another airline: add a microservice that subscribes to the SNS topic and publishes to the SQS queue. Nothing else changes.

Sample: https://github.com/aws-samples/asynchronous-messaging-workshop/tree/master/code/lab-3
Workshop: Scatter-gather lab in the Decoupled Microservices workshop.
Blog: "Application integration patterns for microservices".

### Design checklist

- Correlation ID on every scattered request and response.
- An explicit completion rule: all responses, first N, best within deadline, or quorum.
- A per-request deadline; late responses are ignored or appended.
- The client response states whether it is complete or partial.
- Deduplication in the aggregator.
- Bounded fan-out width.
