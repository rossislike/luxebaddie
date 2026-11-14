// Last step of `pnpm build`: writes a Content-Security-Policy into every page
// of the static export in web/out. See content-security-policy.mjs for the why.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { securePage } from "./content-security-policy.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportDir = path.join(webRoot, "out");

// Reads .env files exactly the way `next build` just did, so both steps agree on the API URL.
nextEnv.loadEnvConfig(webRoot, false, { info: () => {}, error: console.error });

const apiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!apiUrl) throw new Error("NEXT_PUBLIC_API_URL is not set. Copy web/.env.example to web/.env.local.");
const apiOrigin = new URL(apiUrl).origin;

const pages = (await readdir(exportDir, { recursive: true })).filter((file) => file.endsWith(".html"));
if (pages.length === 0) throw new Error(`No pages found in ${exportDir}. Did the export run?`);

await Promise.all(
  pages.map(async (page) => {
    const file = path.join(exportDir, page);
    await writeFile(file, securePage(await readFile(file, "utf8"), apiOrigin));
  }),
);

console.log(`Content-Security-Policy written into ${pages.length} pages (API: ${apiOrigin}).`);
