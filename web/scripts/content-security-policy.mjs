// The storefront's Content-Security-Policy: the browser-enforced list of what a
// page may load and run. It is the main defence against injected scripts.
//
// The site is static, so a policy cannot use per-request nonces. Instead each
// page lists the SHA-256 hash of every inline script Next.js put in it, and the
// browser refuses to run any inline script that is not on the list. The hashes
// differ from page to page, so the policy travels inside each page as a <meta>
// tag rather than as one site-wide header.
//
// A <meta> policy cannot express `frame-ancestors`. That one directive, along
// with the other security headers, is added by CloudFront
// (backend/lib/storefront-hosting.ts).

import { createHash } from "node:crypto";

const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
const CHARSET_META = /<meta charSet="utf-8"\s*\/?>/i;

/**
 * The CSP source expression for each distinct inline script in a page, e.g. "'sha256-abc...='".
 *
 * @param {string} html
 * @returns {string[]}
 */
export function inlineScriptHashes(html) {
  const hashes = [...html.matchAll(INLINE_SCRIPT)].map(
    ([, script]) => `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`,
  );
  return [...new Set(hashes)];
}

/**
 * @param {{ scriptHashes: string[], apiOrigin: string }} sources
 *   scriptHashes: the page's inline scripts. apiOrigin: the backend API the browser calls.
 * @returns {string}
 */
export function contentSecurityPolicy({ scriptHashes, apiOrigin }) {
  return [
    "default-src 'self'",
    // Scripts: our own files, plus exactly the inline scripts this page shipped with.
    ["script-src 'self'", ...scriptHashes].join(" "),
    // React and next/image write style attributes; stylesheets are our own files.
    "style-src 'self' 'unsafe-inline'",
    // Product photos are absolute URLs on an image host (see `images` in the product contract).
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Checkout is a redirect to Stripe, not a form post, so forms never leave the site.
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Returns the page with its policy in place. The tag goes directly after the
 * charset declaration: late enough that the charset stays within the first
 * 1024 bytes browsers scan for it, early enough to precede every script.
 *
 * @param {string} html
 * @param {string} policy
 * @returns {string}
 */
export function withContentSecurityPolicy(html, policy) {
  if (!CHARSET_META.test(html)) {
    throw new Error("Cannot place the Content-Security-Policy: the page has no charset <meta> tag to anchor it to");
  }
  return html.replace(CHARSET_META, (charset) => `${charset}<meta http-equiv="Content-Security-Policy" content="${policy}"/>`);
}

/**
 * @param {string} html one exported page
 * @param {string} apiOrigin
 * @returns {string} the same page, now carrying its own policy
 */
export function securePage(html, apiOrigin) {
  return withContentSecurityPolicy(html, contentSecurityPolicy({ scriptHashes: inlineScriptHashes(html), apiOrigin }));
}
