import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The router is deployed as a CloudFront Function, a runtime without modules,
 * so the file cannot export anything. The test loads it the way CloudFront
 * does: as a script that defines `handler`.
 */
const source = readFileSync(new URL("../../../lib/storefront-page-router.js", import.meta.url), "utf8");
const handler = new Function(`${source}; return handler;`)() as (event: { request: { uri: string } }) => { uri: string };

const fileFor = (uri: string) => handler({ request: { uri } }).uri;

describe("storefront page router", () => {
  it.each([
    ["/shop", "/shop.html"],
    ["/shop/wigs", "/shop/wigs.html"],
    ["/products/body-wave-lace-front-wig", "/products/body-wave-lace-front-wig.html"],
    ["/checkout/success", "/checkout/success.html"],
  ])("serves the page %s from %s", (address, file) => {
    expect(fileFor(address)).toBe(file);
  });

  it("treats a trailing slash as the same page", () => {
    expect(fileFor("/shop/")).toBe("/shop.html");
  });

  it("leaves the home page to the distribution's default root object", () => {
    expect(fileFor("/")).toBe("/");
  });

  it.each([
    "/_next/static/chunks/0c-y_hc6rq5uk.js",
    "/icon.png",
    "/shop.txt",
    "/products/body-wave-lace-front-wig/__next._tree.txt",
    "/404.html",
  ])("passes the file %s through untouched", (file) => {
    expect(fileFor(file)).toBe(file);
  });
});
