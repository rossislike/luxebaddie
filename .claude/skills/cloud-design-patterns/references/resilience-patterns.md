# Resilience Patterns: Retry with Backoff and Circuit Breaker

The network is an unseen participant in every distributed call. The fallacies of distributed computing (Peter Deutsch and others at Sun) warn that newcomers assume the network is reliable, latency is zero, and bandwidth is infinite, and so write minimal error handling. These two patterns are the baseline answer.

| | Retry with backoff | Circuit breaker |
|---|---|---|
| Problem | Transient errors (throttling, brief network loss, momentary unavailability) | Prolonged failure or high latency of a dependency |
| Behavior | Try again with increasing waits, up to a cap | Stop calling entirely for a period; fail fast |
| Risk if misused | Retry storms that worsen the outage | Rejecting calls the callee could have served |
| Use together | Retry inside the closed state; when retries are exhausted, record a failure toward tripping the breaker |

---

## Retry with Backoff

### Intent

Improve stability by transparently retrying operations that fail due to transient errors.

### Motivation

Transient errors come from service throttling, temporary loss of connectivity, or temporary unavailability. Automatic retries improve user experience and resilience. But frequent retries can overload network bandwidth and cause contention. **Exponential backoff** increases the wait between attempts for a bounded number of attempts.

### When to use

- Services throttle requests to prevent overload, returning **429 Too Many Requests**.
- Temporary network issues cause failures.
- The callee is temporarily unavailable; frequent retries without backoff would degrade it further.

### Issues and considerations

| Issue | Guidance |
|---|---|
| **Idempotency** | Required. An operation is idempotent if calling it many times has the same effect as once. Retrying non-idempotent operations can apply partial updates and corrupt state. |
| **Network bandwidth** | Too many retries occupy bandwidth and slow everything down. |
| **Fail fast** | For non-transient errors whose cause you can identify, fail fast with a circuit breaker instead of retrying. |
| **Backoff rate** | Backoff lengthens total wait for the end user; reconcile it with upstream timeouts. |

### Algorithm

```
attempt = 0
loop:
    response = call()
    if success(response):              return response
    if not transient(response):        return failure      # 4xx (except 429), auth, validation
    attempt += 1
    if attempt >= MAX_ATTEMPTS:        return failure
    delay = min(CAP, BASE * MULTIPLIER^(attempt-1))
    sleep(random_between(0, delay))    # "full jitter"
```

- **Classify errors.** The guide's sample retries only on 429 (throttling) and 504 (gateway timeout); any other error stops immediately. Typical transient set: 429, 502, 503, 504, connection reset, timeout.
- **Cap attempts and total time.** Keep the total retry budget below the caller's own timeout.
- **Add jitter.** The guide points to the Amazon Builders' Library article "Timeouts, retries, and backoff with jitter". Without jitter, many clients that failed together retry together and re-create the spike.
- **Retry at one layer.** Retrying at every layer of a call chain multiplies attempts (3 layers x 3 retries = 27 calls on the bottom service).
- **Honor `Retry-After`** when the server sends it.

### Example (from the guide's Step Functions sample)

Max 3 retries, first retry after 3 seconds, backoff rate 1.5:
- Retry 1 after 3 s
- Retry 2 after 3 x 1.5 = 4.5 s
- Retry 3 after 4.5 x 1.5 = 6.75 s
- Then the workflow fails.

With Step Functions this is pure configuration on a task, no custom code:

```json
"Retry": [{
  "ErrorEquals": ["Lambda.ServiceException", "Lambda.TooManyRequestsException", "States.Timeout"],
  "IntervalSeconds": 3,
  "MaxAttempts": 3,
  "BackoffRate": 1.5,
  "JitterStrategy": "FULL"
}]
```

### Sample code (C#, adapted from the guide)

The guide's sample uses `(2^retries - 1) * 100` ms delays (0, 100, 300, 700 ms...) and blocks with `Thread.Sleep` inside an async method. Prefer `Task.Delay` and add jitter:

```csharp
public async Task<HttpResponseMessage> PostWithRetriesAsync(HttpContent content)
{
    const int MaxAttempts = 4;
    for (int attempt = 0; ; attempt++)
    {
        var response = await _client.PostAsync(_baseUrl, content);
        bool transient = response.StatusCode is HttpStatusCode.TooManyRequests
                                             or HttpStatusCode.GatewayTimeout
                                             or HttpStatusCode.ServiceUnavailable;
        if (response.IsSuccessStatusCode || !transient || attempt + 1 >= MaxAttempts)
            return response;

        var ceilingMs = (Math.Pow(2, attempt + 1) - 1) * 100;      // 100, 300, 700 ms ...
        await Task.Delay(TimeSpan.FromMilliseconds(Random.Shared.NextDouble() * ceilingMs));
    }
}
```

In production prefer a library (Polly, resilience4j, tenacity, AWS SDK built-in retry modes) over hand-rolled loops.

Full sample: https://github.com/aws-samples/retry-with-backoff

---

## Circuit Breaker

### Intent

Prevent a caller from repeatedly calling a callee that has recently caused repeated timeouts or failures, and detect when the callee is healthy again. Popularized by Michael Nygard in *Release It!*.

### Motivation

An outage in one microservice can cascade through synchronous call chains and take down the application. Retries help with transient errors, but when the callee is down or a database is in contention, repeated retries cause network contention and **thread pool / connection pool exhaustion** in the caller, and many users retrying makes it worse across the whole application. Calls may also wait indefinitely during an outage, holding resources, and repeated failing calls affect cost.

Like an electrical breaker, the circuit breaker sits between caller and callee and **trips** when the callee is unhealthy.

### When to use

- The caller makes a call that is most likely going to fail.
- High callee latency (for example slow DB connections) causes caller timeouts.
- The caller makes a synchronous call and the callee is unavailable or slow.

### State machine

```
           failures >= threshold
  CLOSED ─────────────────────────▶ OPEN
    ▲                                 │
    │ probe succeeds                  │ expiry timeout elapses
    │                                 ▼
    └──────────────────────────── HALF-OPEN
                probe fails ──────────▶ OPEN (reset expiry)
```

- **Closed:** calls flow to the callee; failures and timeouts are counted.
- **Open:** calls return an immediate failure (or a fallback) without touching the callee.
- **Half-open:** after the expiry timeout, let a trial call through. Success closes the circuit; failure re-opens it.

Running example from the guide: order service (caller) calls payment service (callee) through the breaker. Payment times out repeatedly, the breaker opens, and order gets immediate failures until a periodic probe succeeds.

### Issues and considerations

| Issue | Guidance |
|---|---|
| **Service-agnostic implementation** | Build one reusable, API-driven breaker keyed by callee name rather than per-service code, to prevent code bloat. |
| **Circuit closure by callee** | Optionally let the recovered callee mark its own circuit `CLOSED`, if your RTO needs faster recovery than waiting for the expiry. |
| **Multithreaded calls** | The first failing call sets the expiry timeout. Subsequent concurrent failures must not keep pushing the expiry forward endlessly. |
| **Force open / close** | Operators need a manual override (for example editing the expiry value in the state table). |
| **Observability** | Log every call rejected while the circuit is open. |

### Design choices to make explicit

- **What counts as failure:** timeouts, 5xx, connection errors. Not 4xx caused by the caller.
- **Threshold:** consecutive failures, or failure rate over a sliding window with a minimum call volume.
- **Expiry (open duration):** long enough for the callee to recover; consider growing it on repeated trips.
- **Scope:** per callee, per endpoint, or per callee-instance. Shared state (a table or cache) gives a fleet-wide view; in-process state is faster but each instance learns separately.
- **Fallback:** cached value, default, degraded feature, or queued for later, versus surfacing the error.

### AWS implementation (from the guide)

- **AWS Step Functions Express workflow** implements the decision flow and retries.
- **DynamoDB `CircuitStatus` table** stores degraded services with an `ExpiryTimeStamp`. (ElastiCache for Redis OSS is a faster alternative.)

Flow:
1. A caller starts the workflow with the callee's name (a Lambda function passed as a parameter).
2. **Get Circuit Status** queries `CircuitStatus` for an unexpired record for that callee.
3. Unexpired record exists: circuit is **open**; workflow returns immediately with `FAIL`.
4. No record or expired: **Execute Lambda** calls the callee. Success: `SUCCESS`.
5. On failure or timeout, retry with exponential backoff a set number of times. If still failing, insert a `CircuitStatus` record with `ExpiryTimeStamp` and exit `FAIL`.
6. DynamoDB TTL deletes expired records, which effectively closes the circuit.

```csharp
// GetCircuitStatus Lambda: an unexpired record means the circuit is open
var serviceDetails = await _dbContext.QueryAsync<CircuitBreaker>(
        serviceName, QueryOperator.GreaterThan, new List<object> { currentTimeStamp })
    .GetRemainingAsync();
functionData.CircuitStatus = serviceDetails.Count > 0 ? serviceDetails[0].CircuitStatus : "";
```

```json
"Is Circuit Closed": {
  "Type": "Choice",
  "Choices": [
    { "Variable": "$.CircuitStatus", "StringEquals": "OPEN", "Next": "Circuit Open" },
    { "Variable": "$.CircuitStatus", "StringEquals": "",     "Next": "Execute Lambda" }
  ]
},
"Circuit Open": { "Type": "Fail" }
```

Note: DynamoDB TTL deletion is not immediate (it can lag), which is why the query also filters on `ExpiryTimeStamp > now`.

Full sample: https://github.com/aws-samples/circuit-breaker-netcore-blog
Blog: "Using the circuit breaker pattern with AWS Step Functions and Amazon DynamoDB"

### Related

Strangler fig and ACL ([migration-patterns.md](migration-patterns.md)): the ACL and the strangler proxy both need these protections.
