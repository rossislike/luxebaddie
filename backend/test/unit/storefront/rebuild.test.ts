import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { rebuildQueueHandler } from "../../../src/storefront/adapters/rebuild-queue";
import type { BuildRequest, StorefrontBuilder } from "../../../src/storefront/application/ports";
import { createStorefrontService } from "../../../src/storefront/application/storefront-service";

/** A builder that answers each request for a build with the next scripted outcome. */
function scriptedBuilder(...outcomes: BuildRequest[]): StorefrontBuilder & { requests: number } {
  const builder = {
    requests: 0,
    startBuild: async () => {
      builder.requests++;
      const outcome = outcomes.shift();
      if (!outcome) throw new Error("No more builds were expected");
      return outcome;
    },
  };
  return builder;
}

const started: BuildRequest = { outcome: "started", buildId: "storefront:1" };
const busy: BuildRequest = { outcome: "busy" };
const messages = (...ids: string[]): SQSEvent => ({ Records: ids.map((messageId) => ({ messageId }) as SQSRecord) });

describe("requesting a storefront rebuild", () => {
  it("starts a build", async () => {
    expect(await createStorefrontService(scriptedBuilder(started)).requestRebuild()).toBe("started");
  });

  it("defers the request while another build is running", async () => {
    expect(await createStorefrontService(scriptedBuilder(busy)).requestRebuild()).toBe("deferred");
  });
});

describe("the rebuild queue", () => {
  it("covers a whole batch of changes with a single build", async () => {
    const builder = scriptedBuilder(started);

    const response = await rebuildQueueHandler(createStorefrontService(builder))(messages("a", "b", "c"));

    expect(builder.requests).toBe(1);
    expect(response.batchItemFailures).toEqual([]);
  });

  it("hands every message back when a build is already running, so a later build picks the changes up", async () => {
    const response = await rebuildQueueHandler(createStorefrontService(scriptedBuilder(busy)))(messages("a", "b"));

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "a" }, { itemIdentifier: "b" }]);
  });

  it("fails loudly when a build cannot be started at all", async () => {
    const broken: StorefrontBuilder = {
      startBuild: async () => {
        throw new Error("project not found");
      },
    };

    await expect(rebuildQueueHandler(createStorefrontService(broken))(messages("a"))).rejects.toThrow("project not found");
  });
});
