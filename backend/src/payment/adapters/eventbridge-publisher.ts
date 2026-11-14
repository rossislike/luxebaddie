import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { EVENTS } from "@luxebaddie/contracts";
import { putEvents } from "../../shared/adapters/eventbridge";
import type { EventPublisher, PaymentEvent } from "../application/ports";

function toBusEvent(event: PaymentEvent) {
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
      const busEvent = toBusEvent(event);
      await putEvents(eventBridge, eventBusName, [busEvent]);
      console.log(`Published ${busEvent.detailType}`, { checkoutSessionId: busEvent.detail.checkoutSessionId });
    },
  };
}
