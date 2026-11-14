import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { z } from "zod";

export type QueueHandler = (event: SQSEvent) => Promise<SQSBatchResponse>;

/**
 * Consumes events that EventBridge delivered to this service's SQS queue.
 * Each record wraps one event; `handle` receives its validated detail.
 *
 * Delivery is at-least-once, so `handle` must be idempotent. A record that
 * fails is reported back individually: SQS retries only that one and, after
 * repeated failures, moves it to the dead-letter queue where an alarm fires.
 */
export function eventQueueConsumer<T>(detailSchema: z.ZodType<T>, handle: (detail: T) => Promise<void>): QueueHandler {
  return async (event) => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        const envelope = JSON.parse(record.body) as { detail?: unknown };
        await handle(detailSchema.parse(envelope.detail));
      } catch (error) {
        console.error("Failed to process queued event", { messageId: record.messageId, error });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}
