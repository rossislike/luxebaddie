import { DeleteCommand, type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { basketKey, basketLinesFromItem, basketToItem } from "../../table/basket-item";
import type { BasketRepository } from "../application/ports";

/** One function per basket access pattern. Key formats live in table/basket-item.ts. */
export function dynamoDbBasketRepository(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  now: () => Date = () => new Date(),
): BasketRepository {
  const remove = async (basketId: string) => {
    await ddb.send(new DeleteCommand({ TableName: tableName, Key: basketKey(basketId) }));
  };

  return {
    async findItems(basketId) {
      const { Item } = await ddb.send(new GetCommand({ TableName: tableName, Key: basketKey(basketId) }));
      return basketLinesFromItem(Item, now());
    },

    /** Replaces the whole basket: the shopper's latest bag is a deliberate overwrite. */
    async saveItems(basketId, items) {
      if (items.length === 0) return remove(basketId);
      await ddb.send(new PutCommand({ TableName: tableName, Item: basketToItem(basketId, items, now()) }));
    },

    remove,
  };
}
