import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { Order, Page } from "@luxebaddy/contracts";
import { invalid } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../table/cursor";
import { customerPartition, fulfillmentPartition, orderFromItem, orderKey, orderToItem } from "../../table/order-item";
import { GSI1, GSI2 } from "../../table/schema";
import type { OrderRepository, PageRequest } from "../application/ports";

type CollectionQuery = Pick<QueryCommandInput, "IndexName" | "ScanIndexForward"> & {
  partitionKeyName: string;
  partitionKey: string;
};

/** One function per order access pattern. Key formats live in table/order-item.ts. */
export function dynamoDbOrderRepository(ddb: DynamoDBDocumentClient, tableName: string): OrderRepository {
  /** Reads one page of an item collection that holds only orders. */
  async function queryOrders(query: CollectionQuery, page: PageRequest): Promise<Page<Order>> {
    const { partitionKeyName, partitionKey, ...options } = query;
    const exclusiveStartKey = decodeCursor(page.cursor);
    try {
      const result = await ddb.send(
        new QueryCommand({
          TableName: tableName,
          ...options,
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: { "#pk": partitionKeyName },
          ExpressionAttributeValues: { ":pk": partitionKey },
          Limit: page.limit,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      return {
        items: (result.Items ?? []).map(orderFromItem),
        nextCursor: encodeCursor(result.LastEvaluatedKey),
      };
    } catch (error) {
      // DynamoDB refuses a cursor that belongs to a different list.
      const isBadCursor = exclusiveStartKey && error instanceof Error && error.name === "ValidationException";
      if (isBadCursor) throw invalid("Invalid cursor");
      throw error;
    }
  }

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

    findByFulfillmentStatus: (status, page) =>
      queryOrders(
        { IndexName: GSI2, partitionKeyName: "GSI2PK", partitionKey: fulfillmentPartition(status), ScanIndexForward: true },
        page,
      ),

    findByCustomerEmail: (email, page) =>
      queryOrders(
        { IndexName: GSI1, partitionKeyName: "GSI1PK", partitionKey: customerPartition(email), ScanIndexForward: false },
        page,
      ),
  };
}
