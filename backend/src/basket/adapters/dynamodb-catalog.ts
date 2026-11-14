import { BatchGetCommand, type BatchGetCommandOutput, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Product } from "@luxebaddie/contracts";
import { productFromItem, productKey } from "../../table/product-item";
import type { TableKey } from "../../table/schema";
import type { Catalog } from "../application/ports";

const BATCH_GET_LIMIT = 100;

/**
 * Reads Product items for pricing. The basket service has read-only access to
 * products and never writes them.
 *
 * Trade-off, chosen deliberately: a direct read keeps pricing fast and free of
 * a synchronous service-to-service call (which would need its own retries and
 * circuit breaker). The basket logic only sees the `Catalog` port.
 */
export function dynamoDbCatalog(ddb: DynamoDBDocumentClient, tableName: string): Catalog {
  /** One BatchGetItem round. DynamoDB may return only part of a batch, so keep asking for the rest. */
  async function getBatch(keys: TableKey[]): Promise<Product[]> {
    const products: Product[] = [];
    let pending = keys;
    while (pending.length > 0) {
      const result: BatchGetCommandOutput = await ddb.send(
        new BatchGetCommand({ RequestItems: { [tableName]: { Keys: pending } } }),
      );
      products.push(...(result.Responses?.[tableName] ?? []).map(productFromItem));
      pending = (result.UnprocessedKeys?.[tableName]?.Keys ?? []) as TableKey[];
    }
    return products;
  }

  return {
    async findProducts(productIds) {
      const keys = [...new Set(productIds)].map(productKey);
      const found = new Map<string, Product>();
      for (let start = 0; start < keys.length; start += BATCH_GET_LIMIT) {
        for (const product of await getBatch(keys.slice(start, start + BATCH_GET_LIMIT))) {
          found.set(product.id, product);
        }
      }
      return found;
    },
  };
}
