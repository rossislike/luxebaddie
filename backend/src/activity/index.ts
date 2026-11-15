/**
 * Activity microservice: reads the log of back-office changes. It has no way
 * to write to it: entries are added by the services that make the changes.
 * Composition root - the only file that knows which concrete adapters are used.
 */
import { createDocumentClient } from "../shared/adapters/aws-clients";
import { requireEnv } from "../shared/env";
import { dynamoDbActivityLog } from "./adapters/dynamodb-activity-log";
import { activityHttpHandler } from "./adapters/http";
import { createActivityService } from "./application/activity-service";

const log = dynamoDbActivityLog(createDocumentClient(), requireEnv("TABLE_NAME"));

export const handler = activityHttpHandler(createActivityService(log));
