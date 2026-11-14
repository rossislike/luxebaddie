import { type EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { EVENTS } from "@luxebaddy/contracts";
import type { EventPublisher, PaymentEvent } from "../application/ports";

function toBusEntry(event: PaymentEvent) {
  switch (event.type) {
    case "checkout_completed":
      return { ...EVENTS.checkoutCompleted, detail: event.checkout };
    case "checkout_payment_failed":
      return { ...EVENTS.checkoutPaymentFailed, detail: event.failure };
  }
}

export function eventBridgePublisher(eventBridge: EventBridgeClient, eventBusName: string): EventPublisher {
  return {
    async publish(event) {
      const { source, detailType, detail } = toBusEntry(event);
      const result = await eventBridge.send(
        new PutEventsCommand({
          Entries: [
            { EventBusName: eventBusName, Source: source, DetailType: detailType, Detail: JSON.stringify(detail) },
          ],
        }),
      );
      // PutEvents reports per-entry failures in a successful response.
      if (result.FailedEntryCount) {
        throw new Error(`Failed to publish ${detailType}: ${JSON.stringify(result.Entries)}`);
      }
      console.log(`Published ${detailType}`, { checkoutSessionId: detail.checkoutSessionId });
    },
  };
}
