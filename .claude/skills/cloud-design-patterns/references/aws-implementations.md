# AWS Implementations: Pattern-to-Service Map

The guide pairs each pattern with a reference implementation on AWS. Use this file after the design is settled, to pick services. The patterns themselves are cloud-agnostic; equivalents on other platforms are listed for orientation.

## Quick map

| Pattern | Primary AWS services in the guide | Other options | Non-AWS equivalents |
|---|---|---|---|
| Anti-corruption layer | Class in the monolith calling **API Gateway** -> **Lambda** | Separate ACL service on ECS/Lambda | Any facade/adapter service |
| Hostname routing | **Route 53** + API Gateway, AppSync, ALB + EC2 | Any HTTP service | DNS + any gateway |
| Path routing | NGINX / K8s ingress, **API Gateway** (HTTP proxy, wildcard routes), **CloudFront** + Lambda@Edge | ALB path rules | NGINX, Envoy, Kong, Azure API Management |
| Header routing | Thin routing layer (API Gateway, ALB header rules, Lambda@Edge) | | Envoy, NGINX map |
| Circuit breaker | **Step Functions Express** + **DynamoDB** `CircuitStatus` table with TTL | ElastiCache (Redis OSS) for state | Polly, resilience4j, Hystrix-style libraries, Istio outlier detection |
| Retry with backoff | **Step Functions** task `Retry` config (IntervalSeconds, MaxAttempts, BackoffRate) | AWS SDK retry modes (standard, adaptive) | Polly, resilience4j, tenacity |
| Saga choreography | **EventBridge** custom buses + rules -> **Lambda** participants | SNS + SQS | Kafka, RabbitMQ, Azure Service Bus |
| Saga orchestration | **Step Functions Standard** workflow -> **Lambda** tasks | | Temporal, Camunda, Azure Durable Functions |
| Transactional outbox (table) | **RDS** outbox table + relay -> **SQS** (standard or FIFO) | Lambda on a schedule as the relay | Debezium outbox router |
| Transactional outbox (CDC) | **DynamoDB Streams** or **Kinesis Data Streams** for DynamoDB -> Lambda -> SQS | AWS DMS CDC from RDS | Debezium, Kafka Connect |
| Event sourcing | **Kinesis Data Streams** as event store, **S3** archive, Lambda processors, **Aurora** materialized view | EventBridge (archive and replay), **MSK** | EventStoreDB, Kafka, Marten |
| Publish-subscribe | **SNS** (standard / FIFO), **EventBridge** rules | SNS -> SQS fan-out | Kafka, Google Pub/Sub, Azure Event Grid |
| Scatter-gather (distribution) | **ECS** controller, **S3**, **Step Functions Parallel** state, Lambda aggregator | Step Functions Map / Distributed Map | Spark, any fork-join |
| Scatter-gather (auction) | **SNS** topic, **ECS/EKS** recipients, **SQS** response queue, **Aurora** request IDs, Lambda results service | EventBridge | Kafka request/response topics |
| Hexagonal architecture | **API Gateway** -> **Lambda** (ports/adapters inside) -> **DynamoDB** | | Any language/framework |
| Strangler fig | **API Gateway** as proxy (via Migration Hub Refactor Spaces), **Lambda** services, DynamoDB / ElastiCache / RDS | ALB, CloudFront | NGINX, Envoy, YARP |

## Service notes from the guide

**AWS Step Functions**
- *Express* workflows: high-volume, short-duration; used for the circuit breaker.
- *Standard* workflows: long-running, exactly-once, full execution history; used for saga orchestration.
- Retry with backoff is configuration, not code.
- Multi-AZ with built-in fault tolerance, which addresses the "orchestrator is a single point of failure" concern.
- Enable X-Ray tracing (`TracingEnabled = true`) for saga observability.

**Amazon API Gateway**
- REST APIs: VTL transformations, IAM / Cognito / Lambda authorizers, X-Ray, WAF, basic rate limiting, usage plans.
- Use wildcard proxy routes (`/billing/*`) in a root gateway instead of mapping every path.
- Serverless and multi-AZ, so it is a good strangler proxy.
- Can start Step Functions or write to Kinesis directly without a Lambda in between when no preprocessing is needed.
- Cost can matter at high volume.

**Amazon CloudFront**
- Dynamic origin selection with Lambda@Edge for routing; good for cached APIs.
- Limits: 250 origins; Lambda@Edge updates take minutes and propagation up to 30 minutes.

**Amazon SNS**
- Standard topics: very high throughput, best-effort ordering and dedup.
- FIFO topics: strict ordering and dedup (the guide lists 300 msg/s or 10 MB/s per topic; verify current quotas).
- Subscription filter policies for message filtering; DLQs per subscription.

**Amazon EventBridge**
- Event buses + rules; content-based routing, filtering, multiple producers, fan-out.
- Pipes for point-to-point integrations.
- Archive and replay for event history.

**Amazon SQS**
- Standard: at-least-once, best-effort ordering. Consumers must be idempotent.
- FIFO: ordering per message group, deduplication. Use `MessageGroupId` = aggregate ID to keep per-entity order with parallelism across entities.
- DLQ with redrive policy.

**Amazon DynamoDB**
- TTL for expiring circuit breaker records (deletion can lag, so also filter by timestamp).
- Streams / Kinesis Data Streams integration for CDC-based outbox.

**Amazon Kinesis Data Streams**
- High-throughput, ordered (per shard), replayable stream; used as an event store. Archive to S3 for long-term retention.

**AWS Migration Hub Refactor Spaces**
- Automated strangler fig infrastructure: provisions API Gateway, Network Load Balancer, and resource-based IAM policies, routes traffic to monolith or new services, supports multi-account.
- **Status:** no longer open to new customers as of November 7, 2025. AWS points to **AWS Transform** for similar capabilities. For new projects, build the proxy directly with API Gateway (or ALB/CloudFront) and manage routes in infrastructure as code.

## Strangler fig on AWS: worked example

1. **Initial state:** monolith lifted and shifted to **EC2** in a public subnet, **RDS** in a private subnet, static assets (JS, CSS, React) in **S3**. Single VPC and account for simplicity (production should use a multi-account structure).
2. **Insert proxy:** API Gateway in front of the monolith; all routes go to EC2.
3. **Extract user service:** Lambda + DynamoDB. Add a service endpoint and route; API Gateway sends user traffic to Lambda.
4. **Extract cart service:** Lambda + ElastiCache. Add a route; traffic cuts over.
5. **Extract account service:** Lambda, still using the original RDS database.
6. **Result:** three services, three different databases (polyglot persistence), potentially different languages.
7. **Multi-account:** put services in separate accounts; configure cross-account routing (API Gateway + NLB + resource policies, or private integrations).

Workshop: Iterative App Modernization Workshop.

## Sample repositories cited in the guide

| Pattern | Repository |
|---|---|
| Anti-corruption layer | https://github.com/aws-samples/anti-corruption-layer-pattern |
| Circuit breaker | https://github.com/aws-samples/circuit-breaker-netcore-blog |
| Hexagonal architecture | https://github.com/aws-samples/aws-lambda-domain-model-sample |
| Retry with backoff | https://github.com/aws-samples/retry-with-backoff |
| Saga orchestration | https://github.com/aws-samples/saga-orchestration-netcore-blog |
| Scatter-gather | https://github.com/aws-samples/asynchronous-messaging-workshop/tree/master/code/lab-3 |
| Transactional outbox | https://github.com/aws-samples/transactional-outbox-pattern |

## Further resources named in the guide

- AWS Architecture Center, AWS Developer Center, The Amazon Builders' Library (especially "Timeouts, retries, and backoff with jitter").
- AWS Well-Architected Tool; AWS App2Container; AWS Microservice Extractor for .NET.
- *The Twelve-Factor App* (Adam Wiggins).
- Michael T. Nygard, *Release It!: Design and Deploy Production-Ready Software*, 2nd ed., 2018.
- Martin Fowler: "Polyglot Persistence" and "StranglerFigApplication".
