import { type EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

/** An event as described in the contracts' EVENTS table, plus its payload. */
export type BusEvent = { source: string; detailType: string; detail: unknown };

/** PutEvents accepts at most this many events per call. */
const MAX_EVENTS_PER_CALL = 10;

/**
 * Publishes events to the bus. Throws if any event was not accepted, so the
 * caller's own retry (a webhook redelivery, a stream retry) sends them again.
 * That makes delivery at-least-once: subscribers must be idempotent.
 */
export async function putEvents(eventBridge: EventBridgeClient, eventBusName: string, events: BusEvent[]): Promise<void> {
  for (let start = 0; start < events.length; start += MAX_EVENTS_PER_CALL) {
    const result = await eventBridge.send(
      new PutEventsCommand({
        Entries: events.slice(start, start + MAX_EVENTS_PER_CALL).map(({ source, detailType, detail }) => ({
          EventBusName: eventBusName,
          Source: source,
          DetailType: detailType,
          Detail: JSON.stringify(detail),
        })),
      }),
    );
    // PutEvents reports per-entry failures in a successful response.
    if (result.FailedEntryCount) {
      throw new Error(`Failed to publish ${result.FailedEntryCount} event(s): ${JSON.stringify(result.Entries)}`);
    }
  }
}
