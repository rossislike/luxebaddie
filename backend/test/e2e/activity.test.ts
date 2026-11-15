/**
 * End-to-end tests of the activity log on the deployed dev stage: back-office
 * changes made through the real API, by a signed-in owner and by an
 * AWS-signed caller, and the log read back.
 * Needs AWS credentials for the account.
 *
 *   pnpm test:e2e
 */
import { randomUUID } from "node:crypto";
import type { Activity, Product } from "@luxebaddie/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminFetch, getStackOutputs, type StackOutputs } from "../../scripts/lib/aws";
import { signInTemporaryOwner, type TemporaryOwner } from "./owner";
import { eventually } from "./support";

const STAGE = "dev";
const run = randomUUID().slice(0, 8);

const product: Product = {
  id: `e2e-logged-${run}`,
  name: `E2E Logged Wig ${run}`,
  category: "wigs",
  tagline: "Created by an automated test",
  description: "Safe to delete.",
  highlights: [],
  optionNames: [],
  images: [],
  status: "draft",
  featured: false,
  position: 9999,
  variants: [{ sku: `E2E-LOGGED-${run.toUpperCase()}`, options: {}, priceCents: 10_000, active: true }],
};

type ActivityList = { activity: Activity[]; nextCursor: string | null };

let outputs: StackOutputs;
let adminFetch: typeof fetch;
let owner: TemporaryOwner;

const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const asOwner = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${owner.idToken}` },
});
const ownerDoor = (path: string) => `${outputs.ApiUrl}/backoffice${path}`;
const awsDoor = (path: string) => `${outputs.ApiUrl}/admin${path}`;

const historyOf = async (id: string) => ((await (await adminFetch(awsDoor(`/activity/product/${id}`))).json()) as ActivityList).activity;
/** The product's history once it has `length` entries. It is read from an index, which catches up a moment after a write. */
const historyOfLength = (length: number) => eventually(async () => ((await historyOf(product.id)).length === length ? historyOf(product.id) : null));

beforeAll(async () => {
  outputs = await getStackOutputs(STAGE);
  adminFetch = await createAdminFetch();
  owner = await signInTemporaryOwner(outputs);
});

afterAll(async () => {
  await adminFetch(awsDoor(`/product/${product.id}`), { method: "DELETE" });
  await owner?.remove();
});

describe("the activity log", () => {
  it("has nothing about a product nobody has touched", async () => {
    expect(await historyOf(product.id)).toEqual([]);
  });

  it("records who added a product: the signed-in owner, by email", async () => {
    const before = Date.now();
    const added = await fetch(ownerDoor("/product"), asOwner({ method: "POST", ...json(product) }));
    expect(added.status).toBe(201);

    const [entry] = await historyOfLength(1);

    expect(entry).toMatchObject({
      actor: { kind: "owner", email: owner.email },
      action: "product.added",
      subject: { kind: "product", id: product.id, label: product.name },
      note: "Draft",
    });
    expect(new Date(entry!.at).getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(new Date(entry!.at).getTime()).toBeLessThanOrEqual(Date.now() + 5000);
  });

  it("records nothing for a change that was refused", async () => {
    const refused = await fetch(ownerDoor("/product"), asOwner({ method: "POST", ...json({ ...product, name: "An impostor" }) }));
    expect(refused.status).toBe(409);

    // Long enough for an entry to have shown up in the index, had one been written.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(await historyOf(product.id)).toHaveLength(1);
  });

  it("records a script's change under the AWS identity that signed it, without the account number", async () => {
    const saved = await adminFetch(awsDoor(`/product/${product.id}`), { method: "PUT", ...json({ ...product, status: "active" }) });
    expect(saved.status).toBe(200);

    const [latest] = await historyOfLength(2);

    expect(latest).toMatchObject({ action: "product.saved", note: "For sale" });
    expect(latest?.actor.kind).toBe("automation");
    expect(latest?.actor.kind === "automation" && latest.actor.identity).toMatch(/^(user|assumed-role)\/[^:]+$/);
  });

  it("records a removal, and keeps the product's history after the product is gone", async () => {
    const removed = await fetch(ownerDoor(`/product/${product.id}`), asOwner({ method: "DELETE" }));
    expect(removed.status).toBe(204);

    const history = await historyOfLength(3);

    expect(history.map((entry) => entry.action)).toEqual(["product.removed", "product.saved", "product.added"]);
    expect(history[0]).toMatchObject({ actor: { kind: "owner", email: owner.email }, subject: { label: product.name } });
  });

  it("records nothing for removing a product that is already gone", async () => {
    expect((await fetch(ownerDoor(`/product/${product.id}`), asOwner({ method: "DELETE" }))).status).toBe(204);

    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(await historyOf(product.id)).toHaveLength(3);
  });

  it("lists everything newest first, a page at a time", async () => {
    const page = (query: string) => fetch(ownerDoor(`/activity${query}`), asOwner()).then((response) => response.json() as Promise<ActivityList>);
    const first = await page("?limit=2");
    const second = await page(`?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`);
    const times = [...first.activity, ...second.activity].map((entry) => entry.at);

    expect(first.activity).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(times).toEqual([...times].sort().reverse());
    expect(new Set([...first.activity, ...second.activity].map((entry) => entry.id)).size).toBe(times.length);
  });

  it("includes this run's changes in the list of everything", async () => {
    const { activity } = (await (await adminFetch(awsDoor("/activity?limit=100"))).json()) as ActivityList;

    expect(activity.filter((entry) => entry.subject.id === product.id).map((entry) => entry.action)).toEqual([
      "product.removed",
      "product.saved",
      "product.added",
    ]);
  });

  it("is kept for products and orders only", async () => {
    expect((await adminFetch(awsDoor("/activity/basket/x"))).status).toBe(400);
  });

  it("cannot be written to or erased through the API, even by a signed-in owner", async () => {
    const attempts = await Promise.all([
      fetch(ownerDoor("/activity"), asOwner({ method: "POST", ...json({ action: "product.added" }) })),
      fetch(ownerDoor("/activity"), asOwner({ method: "DELETE" })),
      fetch(ownerDoor(`/activity/product/${product.id}`), asOwner({ method: "DELETE" })),
    ]);

    // API Gateway has no such routes: it answers before any Lambda could run.
    expect(attempts.map((attempt) => attempt.status)).toEqual([403, 403, 403]);
    expect(await historyOf(product.id)).toHaveLength(3);
  });
});
