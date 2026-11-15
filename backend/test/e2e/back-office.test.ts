/**
 * End-to-end tests of the hosted dev back office: its own CloudFront
 * distribution and S3 bucket, and Cognito's sign-in pages in front of it.
 * Needs AWS credentials for the account (to read the stack's outputs).
 *
 *   pnpm test:e2e
 *
 * These tests are the visitor who is not signed in. What a signed-in owner can
 * reach is tested against the API in owner-sign-in.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BUILD_STAMP_PATH, type BuildStamp } from "../../lib/build-stamp";
import { getStackOutputs, type StackOutputs } from "../../scripts/lib/aws";
import { pagePolicy, visibleText } from "./support";

const STAGE = "dev";

/** Every screen of the back office. Add a screen here when one is added to backoffice/src/app/(office). */
const SCREENS = ["/", "/orders", "/order?id=LB-7K3M9Q2XAB", "/customer?email=someone%40example.com", "/catalog", "/product?id=some-wig", "/product/new", "/activity"];
/** The pages a visitor passes through while signing in and out. They show no store data. */
const SIGN_IN_PAGES = ["/sign-in/callback", "/signed-out"];

let outputs: StackOutputs;

const page = (path: string, init?: RequestInit) => fetch(`${outputs.BackOfficeUrl}${path}`, { redirect: "manual", ...init });

beforeAll(async () => {
  outputs = await getStackOutputs(STAGE);
});

describe("hosted back office", () => {
  it("lives at its own address, apart from the storefront", () => {
    expect(new URL(outputs.BackOfficeUrl).host).not.toBe(new URL(outputs.StorefrontUrl).host);
  });

  it.each([...SCREENS, ...SIGN_IN_PAGES])("serves %s as a page", async (path) => {
    const response = await page(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("redirects plain HTTP to HTTPS", async () => {
    const response = await fetch(outputs.BackOfficeUrl.replace("https://", "http://"), { redirect: "manual" });

    expect(response.status).toBe(301);
  });

  it.each(["/", "/no-such-page"])("sends the same security headers as the storefront with %s", async (path) => {
    const [backOffice, storefront] = await Promise.all([page(path), fetch(`${outputs.StorefrontUrl}${path}`, { redirect: "manual" })]);

    for (const header of [
      "strict-transport-security",
      "x-content-type-options",
      "x-frame-options",
      "content-security-policy",
      "referrer-policy",
      "permissions-policy",
      "cross-origin-opener-policy",
    ]) {
      expect(backOffice.headers.get(header), header).toBe(storefront.headers.get(header));
      expect(backOffice.headers.get(header), header).not.toBeNull();
    }
  });

  it("cannot be read from the bucket directly, only through CloudFront", async () => {
    const direct = await fetch(`https://${outputs.BackOfficeBucketName}.s3.amazonaws.com/index.html`);

    expect(direct.status).toBe(403);
  });

  it("says when the build that produced it started", async () => {
    const response = await page(`/${BUILD_STAMP_PATH}`);
    const { startedAt } = (await response.json()) as BuildStamp;

    expect(response.status).toBe(200);
    expect(new Date(startedAt).getTime()).toBeLessThan(Date.now());
  });
});

describe("search engines", () => {
  it.each(["/", "/signed-out", "/no-such-page"])("are told not to list %s, by the server and by the page", async (path) => {
    const response = await page(path);

    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await response.text()).toMatch(/<meta name="robots" content="noindex/);
  });

  it("are asked to stay out altogether", async () => {
    const robots = await (await page("/robots.txt")).text();

    expect(robots).toMatch(/User-agent: \*\s+Disallow: \/\s*$/);
  });
});

describe("a visitor who is not signed in", () => {
  it.each(SCREENS)("is shown nothing of %s but the way to sign-in", async (path) => {
    const html = await (await page(path)).text();

    expect(html).toContain('data-testid="sign-in-gate"');
    expect(visibleText(html)).toBe("Taking you to sign-in...");
  });

  it.each(SCREENS)("is sent no store data with %s", async (path) => {
    const html = await (await page(path)).text();

    // Orders, products and the signed-in owner's address only ever arrive from the API, after signing in.
    expect(html).not.toMatch(/LB-[0-9A-Z]{10}/);
    for (const storeData of ["totalCents", "priceCents", "shippingAddress", 'data-testid="owner-email"']) {
      expect(html).not.toContain(storeData);
    }
  });

  it.each([...SCREENS, ...SIGN_IN_PAGES])(
    "gets a page at %s that runs only its own scripts and talks only to the API, the sign-in service and the photo storage",
    async (path) => {
      const { scriptSources, connectSources, inlineScriptHashes } = pagePolicy(await (await page(path)).text());

      expect(inlineScriptHashes.length).toBeGreaterThan(0);
      expect(scriptSources.filter((source) => source.startsWith("'sha256-")).sort()).toEqual([...inlineScriptHashes].sort());
      expect(scriptSources).not.toContain("'unsafe-inline'");
      expect(connectSources).toEqual([
        "'self'",
        new URL(outputs.ApiUrl).origin,
        new URL(outputs.OwnerSignInIssuer).origin,
        outputs.OwnerSignInPagesUrl,
        outputs.PhotoUploadUrl,
      ]);
    },
  );
});

describe("signing in", () => {
  /** Where the back office sends a visitor to sign in, as the browser would request it. */
  const signInAddress = (returnTo: string) => {
    const address = new URL("/oauth2/authorize", outputs.OwnerSignInPagesUrl);
    address.search = new URLSearchParams({
      client_id: outputs.OwnerUserPoolClientId,
      response_type: "code",
      scope: "openid email",
      redirect_uri: returnTo,
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    }).toString();
    return address;
  };

  it("happens on Cognito's own sign-in page", async () => {
    const response = await fetch(signInAddress(`${outputs.BackOfficeUrl}/sign-in/callback`), { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("never returns a signed-in visitor to an address that is not the back office", async () => {
    const response = await fetch(signInAddress("https://attacker.example/sign-in/callback"), { redirect: "manual" });

    expect(response.headers.get("location") ?? "").not.toContain("attacker.example");
    expect(response.headers.get("location") ?? "/error").toContain("/error");
  });

  it("lets the back office send the owner's token to the API", async () => {
    const preflight = await fetch(`${outputs.ApiUrl}/backoffice/order`, {
      method: "OPTIONS",
      headers: {
        Origin: outputs.BackOfficeUrl,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });

    expect(preflight.headers.get("access-control-allow-origin")).toBe(outputs.BackOfficeUrl);
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  });
});
