import { createHash } from "node:crypto";

/** Polls until `read` returns something other than null. For state that settles a moment after the call that caused it. */
export async function eventually<T>(
  read: () => Promise<T | null>,
  { timeoutMs = 30_000, intervalMs = 1000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the expected state");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** What a published page's own Content-Security-Policy says, next to what the page actually contains. */
export function pagePolicy(html: string) {
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
  const directive = (name: string) => policy.match(new RegExp(`${name} ([^;]+)`))?.[1]?.split(" ") ?? [];
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(([, script]) => script ?? "");
  return {
    scriptSources: directive("script-src"),
    connectSources: directive("connect-src"),
    /** The hash of each inline script in the page, as the policy has to list them for the browser to run them. */
    inlineScriptHashes: [...new Set(inlineScripts.map((script) => `'sha256-${createHash("sha256").update(script).digest("base64")}'`))],
  };
}

/** The words a visitor can read on a page before any script runs. */
export function visibleText(html: string): string {
  const withoutScripts = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ");
  const body = withoutScripts.slice(withoutScripts.indexOf("<body"));
  return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
