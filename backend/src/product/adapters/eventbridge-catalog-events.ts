import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { EVENTS } from "@luxebaddie/contracts";
import { putEvents } from "../../shared/adapters/eventbridge";
import type { CatalogEventPublisher } from "../application/ports";

export function eventBridgeCatalogEvents(eventBridge: EventBridgeClient, eventBusName: string): CatalogEventPublisher {
  return {
    async publishChanges(changes) {
      await putEvents(
        eventBridge,
        eventBusName,
        changes.map((detail) => ({ ...EVENTS.catalogChanged, detail })),
      );
      console.log(`Published ${EVENTS.catalogChanged.detailType}`, { changes });
    },
  };
}
