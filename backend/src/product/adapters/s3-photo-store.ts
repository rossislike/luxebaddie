import { randomUUID } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { MAX_PHOTO_BYTES, type PhotoContentType } from "@luxebaddie/contracts";
import type { PhotoStore } from "../application/ports";

/**
 * Where photos sit in the bucket, which is also their path on the storefront:
 * the CDN serves everything under /media straight from the photo bucket
 * (backend/lib/product-photos.ts).
 */
export const PHOTO_KEY_PREFIX = "media/products/";

const FILE_EXTENSIONS: Record<PhotoContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** A photo's address is never reused for another file, so browsers and the CDN may keep it for good. */
const CACHE_FOREVER = "public,max-age=31536000,immutable";

/** How long an upload permission lasts. Long enough to send one photo on a slow connection. */
const UPLOAD_WINDOW_SECONDS = 5 * 60;

interface PhotoStoreSettings {
  bucketName: string;
  /** The storefront's address, where photos are served from. No trailing slash. */
  publicBaseUrl: string;
}

/**
 * Keeps photos in S3. The browser uploads straight to the bucket with a signed
 * form (a "presigned POST"), so photo files never pass through a Lambda. S3
 * itself enforces what the form allows: this one key, this one kind of file,
 * and no more than MAX_PHOTO_BYTES.
 */
export function s3PhotoStore(s3: S3Client, { bucketName, publicBaseUrl }: PhotoStoreSettings): PhotoStore {
  return {
    async startUpload(contentType) {
      // The name is ours, not the uploader's: nothing a person types ends up in an address.
      const key = `${PHOTO_KEY_PREFIX}${randomUUID()}.${FILE_EXTENSIONS[contentType]}`;
      const { url, fields } = await createPresignedPost(s3, {
        Bucket: bucketName,
        Key: key,
        Expires: UPLOAD_WINDOW_SECONDS,
        Fields: { "Content-Type": contentType, "Cache-Control": CACHE_FOREVER },
        Conditions: [
          ["content-length-range", 1, MAX_PHOTO_BYTES],
          ["eq", "$Content-Type", contentType],
          ["eq", "$Cache-Control", CACHE_FOREVER],
        ],
      });
      return { uploadUrl: url, fields, photoUrl: `${publicBaseUrl}/${key}` };
    },
  };
}
