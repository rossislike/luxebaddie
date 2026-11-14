# API Routing Patterns

Autonomous teams own groups of microservices and expose them as HTTP APIs. There are three ways to route consumers to the right service. Choose based on team structure, consumer experience, and operational maturity. In practice, header routing is usually combined with one of the other two.

| Method | Description | Example |
|---|---|---|
| **Hostname routing** | Each service gets its own hostname | `billing.api.example.com` |
| **Path routing** | Services share a hostname and are separated by URI path | `api.example.com/billing` |
| **Header routing** | Service or action is selected by an HTTP header | `x-example-action: something` |

## Decision guide

| If you care most about... | Prefer |
|---|---|
| Team autonomy, zero shared infrastructure, scalability | Hostname |
| One URL and one doc portal for consumers | Path |
| Versioning, feature flags, A/B tests, exposing selected operations | Header (on top of hostname or path) |
| Response caching at the edge, low cost for unified APIs | Path via CloudFront |
| Auth, WAF, rate limiting, usage tiers built in | Path via API Gateway |
| Lowest cost at very high volume (around 100K TPS or more) with an SRE team | Path via self-managed reverse proxy |

---

## Hostname routing

Give each API its own hostname, for example `service-a.api.example.com` or `service-a.example.com`.

**Typical use case.** Minimizes release friction because nothing is shared between teams. Each team manages everything from DNS to production operations.

**Pros**
- The most straightforward and scalable method.
- Works with any HTTP-compliant service: API Gateway, AppSync, ALB + EC2, and so on.
- Teams fully own their subdomain.
- Easy to isolate, test, and deploy per Region or version: `region.service-a.api.example.com`, `dev.region.service-a.api.example.com`.

**Cons**
- Consumers must remember many hostnames. A client SDK helps, but SDKs bring their own burden: rolling updates, multiple languages, versioning, communicating breaking changes, documentation.
- Every new service needs a new subdomain or domain registered.

---

## Path routing

Group multiple or all APIs under one hostname and separate them by path, for example `api.example.com/service-a`.

**Typical use case.** Most teams choose this for simplicity: consumers remember one URL, and docs live together instead of being split across portals.

**Costs.** A shared ingress adds configuration, authorization, integrations, and latency from extra hops. It needs **mature change management**, because one misconfiguration can disrupt every service. Downstream services can run anywhere on any technology as long as they speak HTTP.

### Option A: HTTP service reverse proxy (NGINX, Kubernetes ingress)

Dynamic routing configuration, for example mapping `api.example.com/my-service/...` to `my-service.internal.api.example.com/...`:

```nginx
server {
    listen 80;
    location ~ ^/([\w-]+)/(.*)$ {
        proxy_pass $scheme://$1.internal.api.example.com/$2;
    }
}
```

- **Pros:** Unifies APIs under one domain while teams still deploy and manage their own APIs with little overhead. Managed tracing and protection (X-Ray, WAF) still apply.
- **Cons:** Extensive testing and infrastructure management (fine if you have SRE). For production readiness you will add observability at every level, extra config, and scripts for rate limiting or usage tokens.
- **Cost:** More expensive than alternatives at low to medium volume; very cost-effective at high volume (around 100K transactions per second or more).

### Option B: Amazon API Gateway (HTTP proxy mode)

A root gateway at `api.example.com` proxies to nested services like `billing.internal.api.example.com`.

- **Do not map every path of every service in the root gateway.** Use wildcard routes such as `/billing/*` so teams can change their APIs without touching the root gateway.
- **Pros (REST APIs):** VTL request and response transformation; auth with IAM, Cognito, or Lambda authorizers; X-Ray tracing; WAF integration; basic rate limiting; usage plans and API keys for consumer tiers.
- **Cons:** Cost can be an issue at high volume.

### Option C: Amazon CloudFront with dynamic origin selection

Lambda@Edge selects the origin (service) per request, routing many services through `api.example.com`.

- **Typical use:** Routing logic is code, so it supports A/B tests, canary releases, feature flags, and path rewriting.
- **Pros:** Good when you want to cache API responses; cost-effective; field-level encryption; WAF for basic rate limiting and ACLs.
- **Cons:** Maximum of 250 origins. Lambda@Edge updates take minutes and CloudFront propagation can take up to 30 minutes, which blocks further updates until complete.

---

## HTTP header routing

Select the target service or action via a header, for example `x-service-a-action: get-thing`. The path still matters because it identifies the resource being acted on.

Also useful for **version routing, feature flags, and A/B tests**. Typically implemented as a thin routing layer in front of some or all microservices.

**Pros**
- Configuration changes are minimal and easy to automate.
- Flexible; can expose only selected operations of a service.

**Cons**
- Assumes control over the client so it can set custom headers.
- Proxies, CDNs, and load balancers limit header size. Usually fine, but watch the total size of headers and cookies.

---

## Review notes

- Match routing to **team topology**: fully autonomous teams lean toward hostname routing; a platform team that owns a shared gateway leans toward path routing.
- A shared path-routing ingress is a **single point of failure and a shared blast radius**. Treat its config like code with review, tests, and staged rollout.
- The end state of a strangler fig migration is one of these schemes; pick it early so the proxy you insert during migration can evolve into it.
