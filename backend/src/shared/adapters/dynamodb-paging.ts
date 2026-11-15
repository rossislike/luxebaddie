import { type DynamoDBDocumentClient, QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import type { Page } from "@luxebaddie/contracts";
import { decodeCursor, encodeCursor } from "../../table/cursor";
import { invalid } from "../errors";
import type { PageRequest } from "../paging";

/** One item collection: everything that shares a partition key, in the table itself or in one of its indexes. */
export type Collection = Pick<QueryCommandInput, "IndexName"> & {
  partitionKeyName: string;
  partitionKey: string;
  /** Which end of the collection to start from. */
  order: "oldest first" | "newest first";
};

/** Reads one page of an item collection that holds a single kind of item. */
export async function queryCollectionPage<T>(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  { partitionKeyName, partitionKey, order, IndexName }: Collection,
  page: PageRequest,
  fromItem: (item: Record<string, unknown>) => T,
): Promise<Page<T>> {
  const exclusiveStartKey = decodeCursor(page.cursor);
  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": partitionKeyName },
        ExpressionAttributeValues: { ":pk": partitionKey },
        ScanIndexForward: order === "oldest first",
        Limit: page.limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    return { items: (result.Items ?? []).map(fromItem), nextCursor: encodeCursor(result.LastEvaluatedKey) };
  } catch (error) {
    // DynamoDB refuses a cursor that belongs to a different list.
    const isBadCursor = exclusiveStartKey && error instanceof Error && error.name === "ValidationException";
    if (isBadCursor) throw invalid("Invalid cursor");
    throw error;
  }
}
