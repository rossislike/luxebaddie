/**
 * Product microservice: the catalog.
 * Composition root - the only file that knows which concrete adapters are used.
 */
import { S3Client } from "@aws-sdk/client-s3";
import { awsClientDefaults, createDocumentClient } from "../shared/adapters/aws-clients";
import { requireEnv } from "../shared/env";
import { dynamoDbProductRepository } from "./adapters/dynamodb-product-repository";
import { productHttpHandler } from "./adapters/http";
import { s3PhotoStore } from "./adapters/s3-photo-store";
import { createCatalogService } from "./application/catalog-service";

const products = dynamoDbProductRepository(createDocumentClient(), requireEnv("TABLE_NAME"));
const photos = s3PhotoStore(new S3Client(awsClientDefaults), {
  bucketName: requireEnv("PHOTO_BUCKET_NAME"),
  publicBaseUrl: requireEnv("PHOTO_BASE_URL"),
});

export const handler = productHttpHandler(createCatalogService(products, photos));
