import { ACTIVITY_ACTIONS, type Activity } from "@luxebaddie/contracts";
import { describe, expect, it } from "vitest";
import { subjectPage, whatHappened, who } from "@/activity/in-words";

const order = { kind: "order", id: "LB-7K3M9Q2XAB", label: "LB-7K3M9Q2XAB" } as const;
const product = { kind: "product", id: "body-wave-wig", label: "Body Wave Wig" } as const;

describe("an activity entry in words", () => {
  it.each(ACTIVITY_ACTIONS)("has words for %s", (action) => {
    expect(whatHappened({ action })).toMatch(/^[a-z]/);
  });

  it("names the owner by email", () => {
    expect(who({ kind: "owner", email: "owner@example.com" })).toBe("owner@example.com");
  });

  it("names an automation by what it is, not by its AWS path", () => {
    expect(who({ kind: "automation", identity: "user/devAdmin" })).toBe("Automation (devAdmin)");
    expect(who({ kind: "automation", identity: "assumed-role/luxebaddie-dev-github-e2e/GitHubActions" })).toBe(
      "Automation (luxebaddie-dev-github-e2e/GitHubActions)",
    );
  });
});

describe("where an entry links to", () => {
  const entry = (overrides: Pick<Activity, "action" | "subject">) => overrides;

  it("links an order's entries to the order", () => {
    expect(subjectPage(entry({ action: "order.shipped", subject: order }))).toBe("/order?id=LB-7K3M9Q2XAB");
  });

  it("links a product's entries to the product", () => {
    expect(subjectPage(entry({ action: "product.saved", subject: product }))).toBe("/product?id=body-wave-wig");
  });

  it("links nowhere for a product that was removed: it has no page any more", () => {
    expect(subjectPage(entry({ action: "product.removed", subject: product }))).toBeNull();
  });
});
