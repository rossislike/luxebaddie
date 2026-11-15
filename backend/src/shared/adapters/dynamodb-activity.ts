import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { type DynamoDBDocumentClient, TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type { Activity } from "@luxebaddie/contracts";
import { activityToItem } from "../../table/activity-item";

/** One write to the table, as a transaction takes it: a Put, an Update or a Delete, with its condition if it has one. */
export type TableWrite = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

const THE_CHANGE = 0;

/**
 * Makes a back-office change and adds its activity log entry in one
 * transaction: either both are stored or neither is.
 *
 * "refused" means the change's own condition did not hold (the product
 * already exists, the order has moved on) and nothing was written, the entry
 * included. An entry is never written over another.
 */
export async function writeWithActivity(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  change: TableWrite,
  activity: Activity,
): Promise<"written" | "refused"> {
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          change,
          { Put: { TableName: tableName, Item: activityToItem(activity), ConditionExpression: "attribute_not_exists(PK)" } },
        ],
      }),
    );
    return "written";
  } catch (error) {
    const changeWasRefused =
      error instanceof TransactionCanceledException && error.CancellationReasons?.[THE_CHANGE]?.Code === "ConditionalCheckFailed";
    if (changeWasRefused) return "refused";
    throw error;
  }
}
