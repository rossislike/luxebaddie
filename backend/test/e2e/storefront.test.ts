/**
 * End-to-end tests of the hosted dev storefront: the real CloudFront
 * distribution and S3 bucket, and the path a catalog change takes to reach
 * them (change stream, event bus, rebuild queue, storefront build).
 * Needs AWS credentials for the account.
 *
 *   pnpm test:e2e
 *
 * The catalog tests publish a real product to the dev storefront and remove
 * it again. Each waits for a storefront build, so they take a few minutes.
 */
import { randomUUID } from "node:crypto";
import type { Product } from "@luxebaddie/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILD_STAMP_PATH, type BuildStamp } from "../../lib/build-stamp";
import { createAdminFetch, getStackOutputs, type StackOutputs } from "../../scripts/lib/aws";
import { eventually, pagePolicy } from "./support";

const STAGE = "dev";
const run = randomUUID().slice(0, 8);

/** Longer than a change takes to go live: collect (30s), wait out a running build if there is one, build and publish. */
const PUBLISH_TIMEOUT_MS = 8 * 60_000;

let outputs: StackOutputs;
let adminFetch: typeof fetch;

const page = (path: string, init?: RequestInit) => fetch(`${outputs.StorefrontUrl}${path}`, { redirect: "manual", ...init });
const api = (path: string) => `${outputs.ApiUrl}${path}`;

beforeAll(async () => {
  outputs = await getStackOutputs(STAGE);
  adminFetch = await createAdminFetch();
});

describe("hosted storefront", () => {
  it.each(["/", "/shop", "/shop/wigs", "/bag", "/checkout/success?session_id=cs_test_x"])(
    "serves %s as a page",
    async (path) => {
      const response = await page(path);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    },
  );

  it("redirects plain HTTP to HTTPS", async () => {
    const response = await fetch(`${outputs.StorefrontUrl.replace("https://", "http://")}/shop`, { redirect: "manual" });

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(`${outputs.StorefrontUrl}/shop`);
  });

  it("answers an address that does not exist with the 404 page", async () => {
    const response = await page(`/products/no-such-product-${run}`);

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("<html");
  });

  it.each(["/shop", "/no-such-page"])("sends the security headers with %s", async (path) => {
    const { headers } = await page(path);

    expect(headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("permissions-policy")).toContain("camera=()");
  });

  it.each(["/", "/shop", "/404.html"])("gives %s a policy that runs only its own inline scripts", async (path) => {
    const { scriptSources, connectSources, inlineScriptHashes } = pagePolicy(await (await page(path)).text());

    expect(inlineScriptHashes.length).toBeGreaterThan(0);
    expect(scriptSources.filter((source) => source.startsWith("'sha256-")).sort()).toEqual([...inlineScriptHashes].sort());
    expect(scriptSources).not.toContain("'unsafe-inline'");
    expect(connectSources).toEqual(["'self'", new URL(outputs.ApiUrl).origin]);
  });

  it("lets browsers keep hashed files for good, but check pages every time", async () => {
    const home = await page("/");
    const hashedFile = (await home.text()).match(/\/_next\/static\/[^"]+\.js/)?.[0];

    expect(home.headers.get("cache-control")).toBe("public,max-age=0,s-maxage=31536000,must-revalidate");
    expect((await page(hashedFile ?? "/missing")).headers.get("cache-control")).toBe("public,max-age=31536000,immutable");
  });

  it("cannot be read from the bucket directly, only through CloudFront", async () => {
    const direct = await fetch(`https://${outputs.StorefrontBucketName}.s3.amazonaws.com/index.html`);

    expect(direct.status).toBe(403);
  });

  it("says when the build that produced it started", async () => {
    const response = await page(`/${BUILD_STAMP_PATH}`);
    const { startedAt } = (await response.json()) as BuildStamp;

    expect(response.status).toBe(200);
    expect(new Date(startedAt).getTime()).toBeLessThan(Date.now());
  });

  it("does not point anyone to the back office", async () => {
    const backOffice = new URL(outputs.BackOfficeUrl).host;

    for (const path of ["/", "/shop", "/bag"]) {
      expect(await (await page(path)).text()).not.toContain(backOffice);
    }
  });

  it("is allowed to call the API", async () => {
    const preflight = await fetch(api("/basket/x"), {
      method: "OPTIONS",
      headers: { Origin: outputs.StorefrontUrl, "Access-Control-Request-Method": "PUT" },
    });

    expect(preflight.headers.get("access-control-allow-origin")).toBe(outputs.StorefrontUrl);
  });
});

describe("when the catalog changes", () => {
  const product: Product = {
    id: `e2e-live-wig-${run}`,
    name: `E2E Live Wig ${run}`,
    category: "wigs",
    tagline: "Created by an automated test",
    description: "Safe to delete.",
    highlights: [],
    optionNames: [],
    images: [],
    status: "active",
    featured: false,
    position: 9999,
    variants: [{ sku: `E2E-LIVE-${run.toUpperCase()}`, options: {}, priceCents: 10_000, active: true }],
  };
  const productPage = () => page(`/products/${product.id}`);
  const eventuallyLive = <T>(read: () => Promise<T | null>) =>
    eventually(read, { timeoutMs: PUBLISH_TIMEOUT_MS, intervalMs: 10_000 });
  /**
   * A publish uploads the pages first and clears CloudFront's cache second. A
   * page that did not exist before can be served as soon as it is uploaded,
   * while a page that did exist (the category listing) is served from the
   * cache until it is cleared. So the listing follows the product page by up
   * to a few minutes, and is waited for separately.
   */
  const eventuallyListed = (listed: boolean) =>
    eventuallyLive(async () => ((await (await page("/shop/wigs")).text()).includes(product.name) === listed ? true : null));

  afterAll(async () => {
    await adminFetch(api(`/admin/product/${product.id}`), { method: "DELETE" });
  });

  it("puts a new product's page live without a deployment", { timeout: 2 * PUBLISH_TIMEOUT_MS + 30_000 }, async () => {
    expect((await productPage()).status).toBe(404);

    const saved = await adminFetch(api(`/admin/product/${product.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(product),
    });
    expect(saved.status).toBe(200);

    // table -> change stream -> CatalogChanged -> rebuild queue -> storefront build -> S3 -> CloudFront
    const html = await eventuallyLive(async () => {
      const response = await productPage();
      return response.ok ? response.text() : null;
    });
    expect(html).toContain(product.name);
    await eventuallyListed(true);
  });

  it("takes the page down when the product is removed", { timeout: 2 * PUBLISH_TIMEOUT_MS + 30_000 }, async () => {
    const removed = await adminFetch(api(`/admin/product/${product.id}`), { method: "DELETE" });
    expect(removed.status).toBe(204);

    await eventuallyLive(async () => ((await productPage()).status === 404 ? true : null));
    await eventuallyListed(false);
  });
});
