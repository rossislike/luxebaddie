import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { CatalogChanged } from "@luxebaddie/contracts";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { productFromItem } from "../../table/product-item";
import type { CatalogEventPublisher } from "../application/ports";

export type ChangeStreamHandler = (event: DynamoDBStreamEvent) => Promise<void>;

/**
 * Turns the table's record of product writes into CatalogChanged events.
 *
 * The stream only contains writes that were committed, so an event can never
 * announce a change that did not happen, and no committed change goes
 * unannounced: a batch that fails is retried by Lambda until it succeeds.
 * A retry can publish the same change twice; subscribers must tolerate that.
 */
export function catalogChangeStreamHandler(events: CatalogEventPublisher): ChangeStreamHandler {
  return async (event) => {
    await events.publishChanges(event.Records.map(toCatalogChange));
  };
}

function toCatalogChange(record: DynamoDBRecord): CatalogChanged {
  const removed = record.eventName === "REMOVE";
  // A removed product only exists in the "before" picture of the item.
  const image = removed ? record.dynamodb?.OldImage : record.dynamodb?.NewImage;
  if (!image) throw new Error(`Change stream record ${record.eventID} carries no item`);

  // aws-lambda and the AWS SDK each declare the same attribute-value shape.
  const product = productFromItem(unmarshall(image as Record<string, AttributeValue>));
  return { productId: product.id, change: removed ? "removed" : "saved" };
}
