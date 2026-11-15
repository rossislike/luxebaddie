import { S3Client } from "@aws-sdk/client-s3";
import { MAX_PHOTO_BYTES } from "@luxebaddie/contracts";
import { describe, expect, it } from "vitest";
import { s3PhotoStore } from "../../../src/product/adapters/s3-photo-store";

// Signing an upload form needs no network: made-up credentials are enough.
const s3 = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "example" } });
const store = s3PhotoStore(s3, { bucketName: "photo-bucket", publicBaseUrl: "https://shop.example" });

/** What S3 will hold the upload to: the signed policy inside the form. */
const policyOf = (fields: Record<string, string>): { conditions: unknown[] } =>
  JSON.parse(Buffer.from(fields.Policy ?? "", "base64").toString("utf8"));

describe("the S3 photo store", () => {
  it("gives every photo its own address under /media/products, named by us and not by the uploader", async () => {
    const [first, second] = await Promise.all([store.startUpload("image/jpeg"), store.startUpload("image/jpeg")]);

    expect(first.photoUrl).toMatch(/^https:\/\/shop\.example\/media\/products\/[0-9a-f-]{36}\.jpg$/);
    expect(first.photoUrl).not.toBe(second.photoUrl);
    expect(first.photoUrl.endsWith(first.fields.key ?? "missing")).toBe(true);
  });

  it.each([
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["image/webp", ".webp"],
  ] as const)("names a %s photo with %s", async (contentType, extension) => {
    expect((await store.startUpload(contentType)).photoUrl.endsWith(extension)).toBe(true);
  });

  it("sends the upload to the photo bucket", async () => {
    expect((await store.startUpload("image/png")).uploadUrl).toContain("photo-bucket");
  });

  it("has S3 refuse a file that is too big, or of a different kind than was agreed", async () => {
    const { fields } = await store.startUpload("image/png");
    const { conditions } = policyOf(fields);

    expect(conditions).toContainEqual(["content-length-range", 1, MAX_PHOTO_BYTES]);
    expect(conditions).toContainEqual(["eq", "$Content-Type", "image/png"]);
    expect(conditions).toContainEqual({ key: fields.key });
    expect(fields["Content-Type"]).toBe("image/png");
  });

  it("lets browsers and the CDN keep a photo for good, since its address is never reused", async () => {
    expect((await store.startUpload("image/jpeg")).fields["Cache-Control"]).toBe("public,max-age=31536000,immutable");
  });
});
