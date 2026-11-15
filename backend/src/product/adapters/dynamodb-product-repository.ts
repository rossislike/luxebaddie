import { type DynamoDBDocumentClient, GetCommand, paginateQuery } from "@aws-sdk/lib-dynamodb";
import type { Product } from "@luxebaddie/contracts";
import { writeWithActivity } from "../../shared/adapters/dynamodb-activity";
import { CATALOG_PARTITION, catalogPrefix, productFromItem, productKey, productToItem } from "../../table/product-item";
import { GSI1 } from "../../table/schema";
import type { ProductRepository } from "../application/ports";

/** One function per catalog access pattern. Key formats live in table/product-item.ts. */
export function dynamoDbProductRepository(ddb: DynamoDBDocumentClient, tableName: string): ProductRepository {
  /**
   * Reads a slice of the catalog collection in GSI1, already in display order.
   * The catalog is small and the storefront needs all of it at build time, so
   * this reads every page rather than exposing a cursor.
   */
  async function queryCatalog(sortKeyPrefix: string): Promise<Product[]> {
    const products: Product[] = [];
    const pages = paginateQuery(
      { client: ddb },
      {
        TableName: tableName,
        IndexName: GSI1,
        KeyConditionExpression: "#pk = :catalog AND begins_with(#sk, :prefix)",
        ExpressionAttributeNames: { "#pk": "GSI1PK", "#sk": "GSI1SK" },
        ExpressionAttributeValues: { ":catalog": CATALOG_PARTITION, ":prefix": sortKeyPrefix },
      },
    );
    for await (const page of pages) products.push(...(page.Items ?? []).map(productFromItem));
    return products;
  }

  return {
    async findById(id) {
      const { Item } = await ddb.send(new GetCommand({ TableName: tableName, Key: productKey(id) }));
      return Item ? productFromItem(Item) : null;
    },

    findForSale: (category) => queryCatalog(catalogPrefix("active", category)),

    findAll: () => queryCatalog(catalogPrefix()),

    /** Create or replace: an admin saving a product is a deliberate overwrite. */
    async save(product, activity) {
      await writeWithActivity(ddb, tableName, { Put: { TableName: tableName, Item: productToItem(product) } }, activity);
    },

    async saveNew(product, activity) {
      const onlyIfFree = { TableName: tableName, Item: productToItem(product), ConditionExpression: "attribute_not_exists(PK)" };
      const outcome = await writeWithActivity(ddb, tableName, { Put: onlyIfFree }, activity);
      return outcome === "written" ? "created" : "already_exists";
    },

    async remove(id, activity) {
      const onlyIfThere = { TableName: tableName, Key: productKey(id), ConditionExpression: "attribute_exists(PK)" };
      const outcome = await writeWithActivity(ddb, tableName, { Delete: onlyIfThere }, activity);
      return outcome === "written" ? "removed" : "not_found";
    },
  };
}
