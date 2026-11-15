import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { queryCollectionPage } from "../../shared/adapters/dynamodb-paging";
import { ACTIVITY_PARTITION, activityFromItem, subjectHistoryPartition } from "../../table/activity-item";
import { GSI1 } from "../../table/schema";
import type { ActivityLog } from "../application/ports";

/** One function per activity access pattern. Key formats live in table/activity-item.ts. */
export function dynamoDbActivityLog(ddb: DynamoDBDocumentClient, tableName: string): ActivityLog {
  return {
    findRecent: (page) =>
      queryCollectionPage(
        ddb,
        tableName,
        { partitionKeyName: "PK", partitionKey: ACTIVITY_PARTITION, order: "newest first" },
        page,
        activityFromItem,
      ),

    findForSubject: (kind, subjectId, page) =>
      queryCollectionPage(
        ddb,
        tableName,
        { IndexName: GSI1, partitionKeyName: "GSI1PK", partitionKey: subjectHistoryPartition(kind, subjectId), order: "newest first" },
        page,
        activityFromItem,
      ),
  };
}
