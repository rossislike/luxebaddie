---
name: cloud-design-patterns
description: 'Choose, design, and review microservice and cloud modernization patterns: strangler fig, anti-corruption layer, API routing (hostname, path, header), circuit breaker, retry with backoff, saga (choreography, orchestration), transactional outbox, event sourcing, publish-subscribe, scatter-gather, and hexagonal architecture. Use when the user mentions "migrate the monolith", "distributed transaction", "dual write", "consistency across services", "compensating transaction", "cascading failures", "retry storm", "exponential backoff", "fan-out", "aggregate responses", "event store", "audit history", "pub/sub", "how to expose my APIs", or "decouple business logic from Lambda". Also trigger when designing AWS architectures with Step Functions, EventBridge, SNS, SQS, Kinesis, DynamoDB Streams, or API Gateway for these problems. For code layering, see clean-architecture. For domain modeling, see domain-driven-design.'
license: MIT
metadata:
  source: 'AWS Prescriptive Guidance: Cloud design patterns, architectures, and implementations (Anitha Deenadayalan, Amazon Web Services, 2026 edition)'
  version: "1.0.0"
---

# Cloud Design Patterns

A practical framework for solving the recurring problems of microservice and cloud-native systems: migrating off a monolith safely, surviving partial failure, keeping data consistent without distributed ACID transactions, and integrating services asynchronously. Each pattern below is a named answer to a specific problem, with known costs. Pick the pattern from the problem, never the other way around.

## Core Principle

**Microservices trade in-process guarantees for independence, and every pattern here exists to buy back one of those guarantees at a known price.** A monolith runs in one process, uses one database, and gets ACID transactions and reliable function calls for free. Microservices run across a network, own separate data stores, scale horizontally, and let a single business transaction span several databases. That means you must deliberately handle network failure, eventual consistency, polyglot persistence, and cross-store transactions. Each pattern solves one of these problems and introduces new ones (latency, operational overhead, complexity, a new single point of failure). A good design names the problem, picks the pattern, and explicitly mitigates the pattern's own issues.

## How to Use This Skill

1. **Identify the problem** using the Pattern Selector below. If the user has picked a pattern already, confirm it actually matches their problem.
2. **Check applicability and the issues list** for the chosen pattern (in the relevant reference file). Every pattern has a "when not to use it" and a set of costs.
3. **Compose patterns.** Most real designs need two or three together (see Pattern Relationships). A saga without idempotent participants, or a pub-sub consumer without dedup, is incomplete.
4. **Map to implementation** (AWS or otherwise) only after the design is right. See [references/aws-implementations.md](references/aws-implementations.md).
5. **Review** using the Design Review Checklist at the end.

## Pattern Selector

| Problem the user describes | Pattern | Reference |
|---|---|---|
| "Rewrite the monolith" / big-bang migration is too risky; business still needs new features during migration | **Strangler fig** | [migration-patterns.md](references/migration-patterns.md) |
| Monolith code must call a feature now living in a microservice with a different model; callers should not change; integrating with a legacy or external system with different semantics | **Anti-corruption layer (ACL)** | [migration-patterns.md](references/migration-patterns.md) |
| How to expose many team-owned services as HTTP APIs | **Hostname, path, or header routing** | [api-routing.md](references/api-routing.md) |
| Transient errors: throttling (HTTP 429), brief network blips, temporarily unavailable service | **Retry with backoff** | [resilience-patterns.md](references/resilience-patterns.md) |
| A dependency is down or slow for an extended period; retries are piling up and exhausting threads, connections, or the database | **Circuit breaker** | [resilience-patterns.md](references/resilience-patterns.md) |
| A business transaction spans several services, each with its own database; no 2PC available | **Saga** (choreography or orchestration) | [distributed-data-patterns.md](references/distributed-data-patterns.md) |
| Service must update its database AND publish an event, and a failure in either leaves things inconsistent ("dual write") | **Transactional outbox** | [distributed-data-patterns.md](references/distributed-data-patterns.md) |
| Need full audit trail, point-in-time reconstruction, replay, or several read models from one source of truth | **Event sourcing** (usually with CQRS) | [distributed-data-patterns.md](references/distributed-data-patterns.md) |
| One event, many independent consumers; sender should not know or wait for receivers | **Publish-subscribe** | [messaging-patterns.md](references/messaging-patterns.md) |
| Send the same or split request to many recipients in parallel and combine the answers (quotes, search, map-reduce) | **Scatter-gather** | [messaging-patterns.md](references/messaging-patterns.md) |
| Business logic is tangled with database, UI, or Lambda handler code; hard to unit test; need to swap infrastructure | **Hexagonal architecture** (ports and adapters) | [hexagonal-architecture.md](references/hexagonal-architecture.md) |

## The Patterns at a Glance

### 1. Migration and modernization

**Strangler fig.** Put a proxy in front of the monolith that initially routes everything to it. Build new features as microservices, then extract existing features one at a time and flip routes. When nothing is left, decommission the monolith. Requires access to the monolith's code base. Best for large monoliths; for small apps a rewrite can be cheaper. The proxy is a single point of failure, so use a highly available managed proxy.

**Anti-corruption layer.** A facade or adapter (for example `UserServiceAdapter`) inside the monolith that translates calls from the old model into the migrated service's new model and routes them there. Callers do not change. It adds latency, operational overhead, and a failure point, so wrap it with retry and circuit breaker, scale it with the target, and record it as technical debt to decommission once all callers have migrated.

**API routing.** Hostname routing (`billing.api.example.com`) gives teams full isolation and is the most scalable, but consumers must track many hostnames. Path routing (`api.example.com/billing`) gives one URL and unified docs, but a shared ingress adds config, auth, latency, and blast radius. Header routing (`x-service-a-action: get-thing`) is flexible for versioning, feature flags, and A/B tests, and is usually layered on top of one of the other two.

### 2. Resilience

**Retry with backoff.** Retry transient failures with increasing waits, a capped number of attempts, and (per the Amazon Builders' Library that the guide cites) jitter. Only retry idempotent operations. Only retry errors that are actually transient (429, 503, 504, timeouts), never validation or auth errors.

**Circuit breaker.** Track failures per callee. After a threshold, "open" the circuit and fail immediately without calling the callee. After an expiry timeout, let a probe through; on success, close the circuit. Make it service-agnostic, let operators force it open or closed, make sure concurrent failures do not keep extending the expiry, and log every call rejected while open.

The two compose: retry handles short blips, the breaker stops retrying when the problem is not short.

### 3. Distributed data consistency

**Saga.** Replace one ACID transaction with a sequence of local transactions (T1, T2, T3), each with a compensating transaction (C1, C2, C3). Platform failures trigger forward recovery (retry and continue). Business failures trigger backward recovery (run compensations in reverse).
- **Choreography:** participants react to each other's events through a broker. No central coordinator, good for a few participants, but dependencies get hard to trace, cyclic dependencies can appear, and end-to-end observability is hard.
- **Orchestration:** a central orchestrator (for example a Step Functions state machine) runs steps and compensations. Scales to many participants and centralizes timeouts, retries, and monitoring, but the orchestrator must itself be highly available.
- Sagas give up isolation: use semantic locks (for example a `PENDING` status) to avoid acting on stale or uncommitted data.

**Transactional outbox.** Write the business row and an outbox row (event, timestamp, sequence number) in the same local transaction. A separate relay reads committed outbox rows and publishes them, then deletes or marks them. Alternatively, use the database's change data capture stream (for example DynamoDB Streams) as the outbox. Delivery is at-least-once, so consumers must be idempotent. Preserve order. Never publish for a rolled-back transaction.

**Event sourcing.** Store every state change as an immutable, append-only, ordered event. Current state is derived by aggregating events, by materialized views, or by replay. Gives audit history, point-in-time recovery, what-if replays, and multiple read models (polyglot projections). Costs: CQRS-style eventual consistency, harder queries, a fast-growing event store (archive it), snapshotting (driven by your RPO), event schema versioning, concurrency control, and side effects to external systems during replay (guard with feature flags).

### 4. Messaging and integration

**Publish-subscribe.** Publishers send to a topic or bus; the broker copies each message to every subscription. Senders are decoupled from receivers and do not wait. Expect: no delivery guarantee to every subscriber type, duplicates, no ordering unless you use FIFO, TTL expiry, and one-way communication. Use queues behind subscribers for durability, filtering to reduce noise, and DLQs for undeliverable messages.

**Scatter-gather.** A controller scatters requests to recipients in parallel; an aggregator gathers, filters, and combines responses. *Scatter by distribution* when the controller knows the recipients; *scatter by auction* (pub-sub) when recipients are unknown or dynamic, correlated by a unique request ID. Set timeouts, tell the client when a response is partial, and remember the slowest recipient sets latency if you wait for all.

### 5. Application structure

**Hexagonal architecture.** Domain logic sits in the center with no knowledge of infrastructure. Ports are technology-agnostic interfaces; adapters implement them for specific tech (REST, GraphQL, DynamoDB, S3). A Lambda handler becomes a thin adapter that builds the input port with its output adapters and calls it. Pays off when there are several input or output technologies or when they will change; otherwise the extra adapter layer is overhead.

## Pattern Relationships

Patterns rarely appear alone. Use these pairings by default:

| If you use... | You almost always also need... | Why |
|---|---|---|
| Strangler fig | ACL, API routing, data synchronization agent | Monolith callers need translation; the proxy needs a routing scheme; the monolith still reads data the new service owns |
| ACL | Retry with backoff, circuit breaker | The ACL is a single point of failure on the call path |
| Saga (either style) | Transactional outbox, idempotent participants, retry | Each step updates its DB and emits an event (a dual write); steps can be redelivered |
| Saga choreography | Event sourcing (optional), strong tracing | Events are the only record of progress |
| Transactional outbox | Idempotent consumers, ordering (FIFO or sequence numbers) | Relay delivery is at-least-once |
| Event sourcing | CQRS or materialized views, snapshots, outbox | Queries against raw events are slow; replays need a start point; publishing must be atomic with the append |
| Pub-sub | Idempotent consumers, DLQs, queues per subscriber | Duplicates, transient subscribers, and poison messages are normal |
| Scatter-gather (auction) | Pub-sub, aggregator with correlation IDs, timeouts | Recipients are unknown to the controller |
| Synchronous calls between microservices | Circuit breaker + retry with backoff | Avoid cascading timeouts and thread-pool exhaustion |
| Hexagonal architecture | Domain-driven design | Each component maps to a subdomain |

## Cross-Cutting Concerns

These show up in nearly every pattern's issue list. Address each explicitly in any design:

- **Idempotency.** Retries, at-least-once delivery, saga redelivery, and outbox relays all cause duplicates. Track processed message IDs or make operations naturally idempotent.
- **Eventual consistency.** Sagas, pub-sub, event sourcing projections, and strangler data sync are all eventually consistent. Set business expectations, or choose a strongly consistent store if the use case truly needs it.
- **Ordering.** Use FIFO topics or queues, message group IDs, or sequence numbers where order matters (event stores, outbox relays).
- **Single points of failure.** ACLs, strangler proxies, saga orchestrators, and routing layers all sit on the critical path. Prefer managed, multi-AZ components and add retry plus circuit breaker on calls through them.
- **Latency.** Every extra layer (ACL, adapter, routing hop, compensations) adds latency. Define and test performance tolerance before production.
- **Observability.** Distributed flows are hard to debug. Log, trace (for example AWS X-Ray), and alert on every hop, especially for choreography and circuit-open rejections.
- **Temporary versus permanent.** ACLs, data synchronization agents, and the strangler proxy are often interim. Record them as technical debt with a decommission plan.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Retrying non-idempotent operations | Make the operation idempotent first (idempotency key, dedup table), or do not retry |
| Retrying everything, including 400s and auth failures | Retry only transient classes: throttling, timeouts, 5xx unavailability |
| Retrying forever or without backoff, causing retry storms | Cap attempts, back off exponentially, add jitter, and add a circuit breaker |
| Writing to the DB then publishing an event as two independent calls | Transactional outbox or CDC |
| Trying to use 2PC across microservice databases | Saga with compensating transactions |
| Choreographed saga with many participants | Switch to orchestration once dependencies become hard to trace |
| Saga without semantic locks | Mark in-flight records (`PENDING`) so concurrent sagas do not read uncommitted state |
| Assuming pub-sub delivers exactly once, in order | Design idempotent consumers; use FIFO where order matters |
| Event sourcing without snapshots or archiving | Snapshot on an RPO-driven schedule; archive old events to cheap storage |
| Replaying events that call external systems | Feature-flag external side effects off during replay; cache external query results |
| ACL left in place forever | Track it as debt; remove when the last caller migrates |
| Decomposing a monolith before understanding the domain | Use DDD and event storming to find boundaries before extracting services |
| Strangler fig on a small app | Consider a straight rewrite; strangler pays off on large monoliths |
| Ports and adapters for a component with one fixed DB and one entry point | Skip the extra layer unless testability or future swaps justify it |
| Mapping every path of every service in the root API gateway | Use wildcard routes (`/billing/*`) and let teams own their sub-APIs |

## Design Review Checklist

Use this when reviewing a proposed microservice or migration design. Report each failed item and the specific pattern or mitigation that fixes it.

1. **Every cross-service write path** either fits in one local transaction or is a saga with defined compensations.
2. **Every "update DB and notify" step** uses a transactional outbox or CDC, not two separate writes.
3. **Every consumer of async messages** is idempotent and has a DLQ or equivalent.
4. **Every synchronous remote call** has a timeout, bounded retries with backoff and jitter, and a circuit breaker where outages can last.
5. **Every component on the critical path** (proxy, ACL, orchestrator, router) is highly available and observable.
6. **Ordering requirements** are stated and enforced (FIFO, group IDs, sequence numbers) or explicitly not needed.
7. **Consistency model** is stated per data flow and agreed with the business.
8. **Interim components** (ACL, sync agent, proxy) have a decommission plan.
9. **Business logic** is testable without infrastructure (ports and adapters, or equivalent).
10. **API exposure** uses a deliberate routing scheme matched to team structure.

Score: 9-10 satisfied is production-ready; 6-8 has gaps that will surface under failure; 5 or fewer means the design is relying on the network and the databases to behave.

## Reference Files

- [references/migration-patterns.md](references/migration-patterns.md): strangler fig and anti-corruption layer, step-by-step migration walkthrough, data synchronization, identifying service boundaries, ACL sample code.
- [references/api-routing.md](references/api-routing.md): hostname, path, and header routing; reverse proxy vs API Gateway vs CloudFront trade-offs.
- [references/resilience-patterns.md](references/resilience-patterns.md): retry with backoff and circuit breaker, state machines, thresholds, sample implementations.
- [references/distributed-data-patterns.md](references/distributed-data-patterns.md): saga choreography and orchestration, transactional outbox (table and CDC), event sourcing.
- [references/messaging-patterns.md](references/messaging-patterns.md): publish-subscribe and scatter-gather.
- [references/hexagonal-architecture.md](references/hexagonal-architecture.md): ports and adapters with a Lambda + DynamoDB walkthrough and unit tests.
- [references/aws-implementations.md](references/aws-implementations.md): pattern-to-AWS-service map, reference architectures, sample repos, and service-specific notes.
