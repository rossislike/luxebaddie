import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  inlineScriptHashes,
  securePage,
  withContentSecurityPolicy,
} from "../content-security-policy.mjs";

const API_ORIGIN = "https://api.example.com";
const SIGN_IN_ORIGIN = "https://sign-in.example.com";
const hashOf = (script: string) => `'sha256-${createHash("sha256").update(script).digest("base64")}'`;

const page = (body: string) => `<!DOCTYPE html><html><head><meta charSet="utf-8"/><title>Shop</title></head><body>${body}</body></html>`;

describe("inlineScriptHashes", () => {
  it("hashes each inline script exactly as written", () => {
    const html = page(`<script>self.a=1</script><script id="x">self.b = "é"\n</script>`);
    expect(inlineScriptHashes(html)).toEqual([hashOf("self.a=1"), hashOf(`self.b = "é"\n`)]);
  });

  it("ignores scripts loaded from a file", () => {
    expect(inlineScriptHashes(page(`<script src="/_next/static/chunks/a.js" async=""></script>`))).toEqual([]);
  });

  it("lists a repeated script once", () => {
    expect(inlineScriptHashes(page("<script>x()</script><script>x()</script>"))).toEqual([hashOf("x()")]);
  });
});

describe("contentSecurityPolicy", () => {
  const policy = contentSecurityPolicy({ scriptHashes: ["'sha256-abc='"], connectOrigins: [API_ORIGIN, SIGN_IN_ORIGIN] });
  const directive = (name: string) => policy.split("; ").find((d) => d.startsWith(`${name} `) || d === name);

  it("runs only our own script files and the listed inline scripts", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'sha256-abc='");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("lets the browser call the services it was given and nothing else", () => {
    expect(directive("connect-src")).toBe(`connect-src 'self' ${API_ORIGIN} ${SIGN_IN_ORIGIN}`);
  });

  it("locks down everything it does not mention", () => {
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
  });
});

describe("withContentSecurityPolicy", () => {
  it("places the policy straight after the charset, ahead of any script", () => {
    const html = withContentSecurityPolicy(page("<script>x()</script>"), "default-src 'self'");
    expect(html).toContain(`<meta charSet="utf-8"/><meta http-equiv="Content-Security-Policy" content="default-src 'self'"/>`);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script"));
  });

  it("refuses a page it cannot place the policy in, rather than shipping it unprotected", () => {
    expect(() => withContentSecurityPolicy("<html><head></head></html>", "default-src 'self'")).toThrow(/charset/);
  });
});

describe("securePage", () => {
  it("gives a page a policy that allows its own inline scripts", () => {
    const html = securePage(page("<script>hydrate()</script>"), [API_ORIGIN]);
    expect(html).toContain(`script-src 'self' ${hashOf("hydrate()")};`);
  });
});
