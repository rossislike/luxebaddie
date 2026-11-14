/**
 * Product microservice: the catalog.
 * Composition root - the only file that knows which concrete adapters are used.
 */
import { createDocumentClient } from "../shared/adapters/aws-clients";
import { requireEnv } from "../shared/env";
import { dynamoDbProductRepository } from "./adapters/dynamodb-product-repository";
import { productHttpHandler } from "./adapters/http";
import { createCatalogService } from "./application/catalog-service";

const products = dynamoDbProductRepository(createDocumentClient(), requireEnv("TABLE_NAME"));

export const handler = productHttpHandler(createCatalogService(products));
