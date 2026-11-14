import { marshall } from "@aws-sdk/util-dynamodb";
import type { CatalogChanged } from "@luxebaddie/contracts";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { catalogChangeStreamHandler } from "../../../src/product/adapters/catalog-change-stream";
import type { CatalogEventPublisher } from "../../../src/product/application/ports";
import { productToItem } from "../../../src/table/product-item";
import { lashes, wig } from "../fixtures";

type Image = NonNullable<NonNullable<DynamoDBRecord["dynamodb"]>["NewImage"]>;
const imageOf = (product: typeof wig) => marshall(productToItem(product)) as Image;

const saved = (product: typeof wig, eventName: "INSERT" | "MODIFY" = "INSERT"): DynamoDBRecord => ({
  eventID: `save-${product.id}`,
  eventName,
  dynamodb: { NewImage: imageOf(product) },
});
const removed = (product: typeof wig): DynamoDBRecord => ({
  eventID: `remove-${product.id}`,
  eventName: "REMOVE",
  dynamodb: { OldImage: imageOf(product) },
});
const streamOf = (...Records: DynamoDBRecord[]): DynamoDBStreamEvent => ({ Records });

function recordingCatalogEvents(): CatalogEventPublisher & { published: CatalogChanged[] } {
  const published: CatalogChanged[] = [];
  return { published, publishChanges: async (changes) => void published.push(...changes) };
}

describe("relaying catalog changes from the table's change stream", () => {
  it("announces new and edited products as saved, and deleted ones as removed, in order", async () => {
    const events = recordingCatalogEvents();

    await catalogChangeStreamHandler(events)(streamOf(saved(wig), saved(lashes, "MODIFY"), removed(wig)));

    expect(events.published).toEqual([
      { productId: "test-wig", change: "saved" },
      { productId: "test-lashes", change: "saved" },
      { productId: "test-wig", change: "removed" },
    ]);
  });

  it("fails the batch when publishing fails, so the stream delivers it again", async () => {
    const failing: CatalogEventPublisher = {
      publishChanges: async () => {
        throw new Error("bus unavailable");
      },
    };

    await expect(catalogChangeStreamHandler(failing)(streamOf(saved(wig)))).rejects.toThrow("bus unavailable");
  });

  it("refuses a record it cannot identify rather than skipping it", async () => {
    const record: DynamoDBRecord = { eventID: "odd", eventName: "INSERT", dynamodb: {} };

    await expect(catalogChangeStreamHandler(recordingCatalogEvents())(streamOf(record))).rejects.toThrow(/carries no item/);
  });
});
