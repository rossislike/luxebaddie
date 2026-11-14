# Migration Patterns: Strangler Fig and Anti-Corruption Layer

These two patterns work as a pair when moving from a monolith to microservices. The strangler fig governs *how traffic moves* from old to new. The anti-corruption layer governs *how the remaining old code talks to the new code* without being changed or polluted by the new model.

---

## Strangler Fig

### Intent

Migrate a monolithic application to a microservices architecture incrementally, with reduced transformation risk and business disruption. Introduced by Martin Fowler; named after the fig vine that grows around a host tree until it replaces it.

### Motivation

Monoliths put most functionality in one process, with tightly coupled code. Over time:

- Changes cannot be tested in isolation, so every change needs thorough regression testing and cycle time grows.
- Complexity increases maintenance time and time to market, slowing innovation.
- Cognitive load rises and team ownership boundaries blur.
- Individual features cannot scale independently; the whole application scales for peak load.
- The technology ages and support costs rise.

Splitting into microservices gives independent scaling, independent releases, team ownership, and smaller blast radius per change. But a **big-bang rewrite** is a huge undertaking: it introduces transformation risk and business disruption, and it is extremely hard to add features while the rewrite is in flight.

### When to use

- You want to migrate a monolith to microservices gradually.
- A big-bang migration is risky because of the monolith's size and complexity.
- The business needs new features and cannot wait for the transformation to finish.
- End users must be minimally impacted.

### When not to use

- **Small applications.** If complete refactoring is low complexity, rewriting directly in a microservices architecture can be more efficient.
- **No code base access.** You need to modify the monolith (to add an ACL and to let a proxy intercept calls). Without access you cannot intercept internal calls.

### Issues and considerations

| Issue | Guidance |
|---|---|
| **Code base access** | Required. Expect minor changes in the monolith, an ACL inside it, and some refactoring so the proxy can intercept migrated features. |
| **Unclear domain** | Premature decomposition is costly when the domain is not understood and service boundaries end up wrong. Use domain-driven design (DDD) to understand the domain and event storming to find boundaries. |
| **Identifying microservices** | Look for natural divisions between service classes. Services that own their own data access object decouple easily. Classes with related business logic and few dependencies are good candidates. Refactor inside the monolith first to break tight coupling. Also weigh compliance requirements, release cadence, team geography, scaling needs, technology needs per use case, and team cognitive load. |
| **Anti-corruption layer** | When monolith features must call migrated features, add an ACL that converts calls to the new interface and routes them. See below. |
| **Proxy layer failure** | The proxy that splits traffic between old and new is a single point of failure and a potential bottleneck. Use a highly available managed proxy (for example Amazon API Gateway, serverless and multi-AZ). |
| **Service interactions** | Synchronous calls between services risk timeouts consuming connections and thread pools. Use a circuit breaker for operations likely to fail for extended periods. Prefer asynchronous communication via events and queues where possible. |
| **Data aggregation** | Data is now spread across databases. Aggregate in the front end (for example AWS AppSync / GraphQL) or with CQRS in the back end. |
| **Data consistency** | The monolith may still need data the new service owns. Synchronize with a queue and agent, but this creates redundancy and eventual consistency. Treat it as tactical until a long-term solution (for example a data lake) exists. |

### Implementation walkthrough

The running example is a storefront monolith with three services, **user**, **cart**, and **account**, sharing one relational database. Cart depends on user.

1. **Insert the proxy.** Put a proxy layer between the storefront UI and the monolith. Initially it routes 100% of traffic to the monolith. Nothing changes for users.
2. **New features go to new services.** Stop adding features to the monolith; build them as microservices. Keep fixing bugs in the monolith for stability. The proxy routes by API URL to either the monolith or the new service.
3. **Extract the first service (user).** Move user into its own microservice with its own data store. Route user API traffic to it through the proxy.
4. **Add an ACL for internal callers.** Cart still lives in the monolith and still calls the user service there. The monolith's user service now delegates through an ACL (`UserServiceFacade` / `UserServiceAdapter`) that translates to the new user microservice's interface. Cart does not know the migration happened. This loose coupling reduces regression and disruption.
5. **Synchronize data back.** The monolith (reports, unmigrated components, downstream apps) may still need user data. The user microservice publishes an event to a queue whenever its database changes; a synchronizing agent consumes the queue and updates the monolithic database. That copy is eventually consistent.
6. **Extract the next service (cart).** When cart moves out, change its code to call the user microservice directly. The ACL no longer handles those calls.
7. **Finish strangling.** When account is also migrated, only a skeleton of the monolith remains. Migrate historical data to the services' own stores, remove the ACL, and decommission the monolith.
8. **Settle the final routing.** Expose each service via path (`www.storefront.com/user`) or hostname (`user.storefront.com`). See [api-routing.md](api-routing.md).

Outcome: each service can use a different, purpose-built database (polyglot persistence) and even a different language.

### Practical guidance

- Order extractions by **low dependency and high value**. Services with their own data access and few inbound dependencies go first.
- Every extraction is a **route flip at the proxy**, which is also your rollback: flip the route back.
- In production, deploy microservices in **separate accounts** for deployment independence, and configure cross-account routing from the proxy.
- Keep a **migration ledger**: which routes point where, which ACLs exist, which sync agents run, and what removes each one.

---

## Anti-Corruption Layer (ACL)

### Intent

A mediation layer that translates domain model semantics from one system to another. It translates the model of the **upstream** bounded context (for example the monolith, or a legacy or external system) into a model that suits the **downstream** bounded context (for example the new microservice), and vice versa, so neither has to adopt the other's model. It reduces transformation risk by letting callers be redirected transparently.

Most applicable when the downstream context contains a core subdomain worth protecting, or when the upstream model is an unmodifiable legacy system.

### When to use

- The monolith must call a function migrated to a microservice whose model or semantics differ from the original.
- Two systems with different semantics must exchange data and modifying either to match is impractical.
- You want a quick, simplified way to adapt one system to another with minimal impact.
- Your application talks to an external system.

### Issues and considerations

| Issue | Guidance |
|---|---|
| **Team dependencies** | Different teams own callers and callees and cannot coordinate changes. The ACL absorbs the semantic change so callers do not have to. |
| **Operational overhead** | The ACL must be monitored, alerted on, released, and wired into CI/CD like any other component. |
| **Single point of failure** | If the ACL fails, the target service is unreachable. Build in retry with backoff and circuit breakers; set up alerts and logging to cut MTTR. |
| **Technical debt** | Decide up front whether it is interim or long-term. If interim, record it as debt and decommission it when all dependent callers have migrated. |
| **Latency** | Translation adds latency. Define and test performance tolerance for latency-sensitive paths before production. |
| **Scaling bottleneck** | Under peak load the ACL can throttle a target that scales on demand. Design the ACL to scale with the target. |
| **Shared vs service-specific** | One shared ACL for many services, or one class per service. Decide based on latency, scaling, and failure isolation. |

### Implementation

Two placements:

- **Inside the monolith** as a service-specific class (`UserServiceFacade`, `UserServiceAdapter`). Simplest during strangler migrations.
- **As an independent service.** Better when several systems need the same translation or the ACL must scale separately.

Either way, the original caller keeps calling the original interface. The original implementation is replaced with a delegation to the ACL, which:

1. Maps the source object to the target model (rename fields, merge fields, convert types, validate).
2. Calls the target service (for example through an API Gateway endpoint fronting a Lambda function).
3. Maps the response (or status) back to what the caller expects.

### Sample (C#, from the guide, lightly cleaned)

```csharp
// Original service inside the monolith. Its public interface is unchanged,
// so callers such as the cart service are unaware of the migration.
public class UserInMonolith : IUserInMonolith
{
    private readonly IACL _userServiceACL;
    public UserInMonolith(IACL userServiceACL) => _userServiceACL = userServiceACL;

    public async Task<HttpStatusCode> UpdateAddress(UserDetails userDetails)
    {
        var destUserDetails = new UserDetailsWrapped("user", userDetails);
        // Address update logic now lives in the user microservice.
        return await _userServiceACL.CallMicroservice(destUserDetails);
    }
}

// The ACL translates the monolith's model into the microservice's model.
public class UserServiceACL : IACL
{
    private static readonly HttpClient _client = new HttpClient();
    private readonly string _apiGatewayBaseUrl; // from configuration

    public async Task<HttpStatusCode> CallMicroservice(ISourceObject details)
    {
        var url = $"{_apiGatewayBaseUrl}/{details.ServiceName}";
        var userDetails = (UserDetails)details;

        if (!int.TryParse(userDetails.ZipCode, out var zipCode))
            return HttpStatusCode.BadRequest;     // translation can reject invalid input

        var model = new UserMicroserviceModel
        {
            UserId  = userDetails.UserId,
            Address = $"{userDetails.AddressLine1}, {userDetails.AddressLine2}", // two fields -> one
            City    = userDetails.City,
            State   = userDetails.State,
            Country = userDetails.Country,
            ZipCode = zipCode                                                    // string -> int
        };

        var content = new StringContent(JsonSerializer.Serialize(model), Encoding.UTF8, "application/json");
        var response = await _client.PostAsync(url, content);
        return response.StatusCode;
    }
}
```

Note: the original sample appends to a static base URL on every call (`_apiGatewayDev += "/" + ...`), which accumulates path segments across calls. Build the URL per call, as above.

Full sample: https://github.com/aws-samples/anti-corruption-layer-pattern

### Design tips

- Keep the ACL **pure translation plus routing**. Business rules belong in the services on either side.
- Make the translation **explicit and tested**: one mapping function per direction with unit tests for edge cases (format conversions, merged and split fields, defaults).
- Put **retry, timeout, and circuit breaker** around the outbound call.
- The ACL is the natural place for **feature-flagged cutover**: route a percentage of calls to the new service and compare.

### Related

Strangler fig (above), [resilience-patterns.md](resilience-patterns.md) (circuit breaker, retry), [api-routing.md](api-routing.md).
