import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { writeWithActivity } from "../../shared/adapters/dynamodb-activity";
import { queryCollectionPage } from "../../shared/adapters/dynamodb-paging";
import {
  customerPartition,
  fulfillmentAttributes,
  fulfillmentPartition,
  orderFromItem,
  orderKey,
  orderToItem,
} from "../../table/order-item";
import { GSI1, GSI2 } from "../../table/schema";
import type { OrderRepository } from "../application/ports";

/** One function per order access pattern. Key formats live in table/order-item.ts. */
export function dynamoDbOrderRepository(ddb: DynamoDBDocumentClient, tableName: string): OrderRepository {
  return {
    async saveIfNew(order) {
      try {
        await ddb.send(
          new PutCommand({
            TableName: tableName,
            Item: orderToItem(order),
            ConditionExpression: "attribute_not_exists(PK)",
          }),
        );
        return "created";
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) return "already_exists";
        throw error;
      }
    },

    async findById(id) {
      const { Item } = await ddb.send(new GetCommand({ TableName: tableName, Key: orderKey(id) }));
      return Item ? orderFromItem(Item) : null;
    },

    async saveFulfillment(order, from, activity) {
      const changes = Object.entries(fulfillmentAttributes(order));
      const update = {
        TableName: tableName,
        Key: orderKey(order.id),
        UpdateExpression: `SET ${changes.map((_, index) => `#a${index} = :v${index}`).join(", ")}`,
        // The order must exist and still be where this change started from.
        ConditionExpression: "attribute_exists(PK) AND #status = :from",
        ExpressionAttributeNames: {
          "#status": "fulfillmentStatus",
          ...Object.fromEntries(changes.map(([name], index) => [`#a${index}`, name])),
        },
        ExpressionAttributeValues: {
          ":from": from,
          ...Object.fromEntries(changes.map(([, value], index) => [`:v${index}`, value])),
        },
      };
      const outcome = await writeWithActivity(ddb, tableName, { Update: update }, activity);
      return outcome === "written" ? "saved" : "changed_meanwhile";
    },

    findByFulfillmentStatus: (status, page) =>
      queryCollectionPage(
        ddb,
        tableName,
        { IndexName: GSI2, partitionKeyName: "GSI2PK", partitionKey: fulfillmentPartition(status), order: "oldest first" },
        page,
        orderFromItem,
      ),

    findByCustomerEmail: (email, page) =>
      queryCollectionPage(
        ddb,
        tableName,
        { IndexName: GSI1, partitionKeyName: "GSI1PK", partitionKey: customerPartition(email), order: "newest first" },
        page,
        orderFromItem,
      ),
  };
}
