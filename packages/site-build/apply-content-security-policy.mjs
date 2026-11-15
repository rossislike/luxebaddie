#!/usr/bin/env node
// Last step of a site's build: writes a Content-Security-Policy into every page
// of the static export in ./out. See content-security-policy.mjs for the why.
//
//   apply-content-security-policy NEXT_PUBLIC_API_URL [MORE_ENV_VARS...]
//
// Run from the site's own folder. Each argument names an environment variable
// holding the address of a service the site's pages call from the browser.
// Those origins, and the site itself, are the only ones the pages may connect to.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { securePage } from "./content-security-policy.mjs";

const siteRoot = process.cwd();
const exportDir = path.join(siteRoot, "out");

// Reads .env files exactly the way `next build` just did, so both steps agree on the addresses.
nextEnv.loadEnvConfig(siteRoot, false, { info: () => {}, error: console.error });

const variableNames = process.argv.slice(2);
if (variableNames.length === 0) throw new Error("Name at least one environment variable that holds an address the site calls.");

const connectOrigins = variableNames.map((name) => {
  const address = process.env[name];
  if (!address) throw new Error(`${name} is not set. Copy .env.example to .env.local.`);
  return new URL(address).origin;
});

const pages = (await readdir(exportDir, { recursive: true })).filter((file) => file.endsWith(".html"));
if (pages.length === 0) throw new Error(`No pages found in ${exportDir}. Did the export run?`);

await Promise.all(
  pages.map(async (page) => {
    const file = path.join(exportDir, page);
    await writeFile(file, securePage(await readFile(file, "utf8"), connectOrigins));
  }),
);

console.log(`Content-Security-Policy written into ${pages.length} pages (may connect to: ${connectOrigins.join(", ")}).`);
