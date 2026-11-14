import type { QueueHandler } from "../../shared/adapters/event-queue";
import type { StorefrontService } from "../application/storefront-service";

/**
 * Reacts to anything that makes the live storefront out of date: a
 * CatalogChanged event, or a finished deployment of the stack.
 *
 * What a message says does not matter, only that it arrived, and one build
 * covers every change made before it started. So a whole batch (a burst of
 * catalog edits) costs a single build. If a build is already running, the
 * batch is handed back to the queue and redelivered once the visibility
 * timeout passes, which guarantees a build that starts after the last change.
 * Redelivery only ever causes an extra build, which is harmless.
 */
export function rebuildQueueHandler(storefront: StorefrontService): QueueHandler {
  return async (event) => {
    const outcome = await storefront.requestRebuild();
    const retryLater = outcome === "deferred" ? event.Records : [];
    return { batchItemFailures: retryLater.map((record) => ({ itemIdentifier: record.messageId })) };
  };
}
