/**
 * Product microservice, change relay: announces every catalog change on the
 * event bus. It runs as its own Lambda so that reading the table's change
 * stream (which carries every service's items) stays out of the catalog API's
 * permissions. A relay has no business rule of its own, so the stream adapter
 * is wired straight to the publishing port.
 * Composition root - the only file that knows which concrete adapters are used.
 */
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { awsClientDefaults } from "../shared/adapters/aws-clients";
import { requireEnv } from "../shared/env";
import { catalogChangeStreamHandler } from "./adapters/catalog-change-stream";
import { eventBridgeCatalogEvents } from "./adapters/eventbridge-catalog-events";

const catalogEvents = eventBridgeCatalogEvents(new EventBridgeClient(awsClientDefaults), requireEnv("EVENT_BUS_NAME"));

export const handler = catalogChangeStreamHandler(catalogEvents);
