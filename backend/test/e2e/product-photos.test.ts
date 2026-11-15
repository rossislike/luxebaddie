/**
 * End-to-end tests of product photos on the deployed dev stage: the real photo
 * bucket, the upload permissions the product service issues, and the
 * storefront's CDN serving what was uploaded.
 * Needs AWS credentials for the account.
 *
 *   pnpm test:e2e
 */
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MAX_PHOTO_BYTES, type PhotoUpload } from "@luxebaddie/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminFetch, getStackOutputs, type StackOutputs } from "../../scripts/lib/aws";
import { eventually } from "./support";

const STAGE = "dev";

/** The smallest valid JPEG: one grey pixel. */
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  "base64",
);

let outputs: StackOutputs;
let adminFetch: typeof fetch;
const uploaded: string[] = [];

async function startUpload(contentType: string): Promise<Response> {
  return adminFetch(`${outputs.ApiUrl}/admin/product-photo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType }),
  });
}

async function permissionFor(contentType: string): Promise<PhotoUpload> {
  const { upload } = (await (await startUpload(contentType)).json()) as { upload: PhotoUpload };
  uploaded.push(new URL(upload.photoUrl).pathname.slice(1));
  return upload;
}

/** Sends a file the way the back office does: a form post, the signed fields first and the file last. */
function send(upload: PhotoUpload, file: Buffer, sentAs = upload.fields["Content-Type"] ?? ""): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, name === "Content-Type" ? sentAs : value);
  form.append("file", new Blob([new Uint8Array(file)], { type: sentAs }));
  return fetch(upload.uploadUrl, { method: "POST", body: form });
}

beforeAll(async () => {
  outputs = await getStackOutputs(STAGE);
  adminFetch = await createAdminFetch();
});

afterAll(async () => {
  const s3 = new S3Client({});
  for (const key of uploaded) await s3.send(new DeleteObjectCommand({ Bucket: outputs.PhotoBucketName, Key: key }));
});

describe("uploading a product photo", () => {
  let photo: PhotoUpload;

  it("is refused for a kind of file that is not a photo", async () => {
    const [gif, svg] = await Promise.all([startUpload("image/gif"), startUpload("image/svg+xml")]);

    expect([gif.status, svg.status]).toEqual([400, 400]);
  });

  it("gives the photo an address on the storefront before it is sent", async () => {
    photo = await permissionFor("image/jpeg");

    expect(photo.photoUrl).toMatch(new RegExp(`^${outputs.StorefrontUrl}/media/products/[0-9a-f-]{36}\\.jpg$`));
    expect(new URL(photo.uploadUrl).origin).toBe(outputs.PhotoUploadUrl);
    expect((await fetch(photo.photoUrl)).status).toBe(404);
  });

  it("accepts the photo straight from the browser", async () => {
    expect((await send(photo, TINY_JPEG)).status).toBe(204);
  });

  it("serves it to shoppers through the storefront, to keep for good", async () => {
    // The storefront remembered for a minute that this address had nothing at it.
    const served = await eventually(
      async () => {
        const response = await fetch(photo.photoUrl);
        return response.ok ? response : null;
      },
      { timeoutMs: 120_000, intervalMs: 5000 },
    );

    expect(Buffer.from(await served.arrayBuffer()).equals(TINY_JPEG)).toBe(true);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("cache-control")).toBe("public,max-age=31536000,immutable");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("cannot be read from the bucket directly, only through the storefront", async () => {
    const direct = await fetch(`${outputs.PhotoUploadUrl}${new URL(photo.photoUrl).pathname}`);

    expect(direct.status).toBe(403);
  });
});

describe("what an upload permission does not allow", () => {
  it("a file bigger than the limit", async () => {
    const tooBig = Buffer.alloc(MAX_PHOTO_BYTES + 1, 1);
    const refused = await send(await permissionFor("image/jpeg"), tooBig);

    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("EntityTooLarge");
  });

  it("a different kind of file than was agreed", async () => {
    const refused = await send(await permissionFor("image/jpeg"), TINY_JPEG, "text/html");

    expect(refused.status).toBe(403);
  });

  it("a different address than the one it was issued for", async () => {
    const upload = await permissionFor("image/jpeg");
    const elsewhere = { ...upload, fields: { ...upload.fields, key: "index.html" } };

    expect((await send(elsewhere, TINY_JPEG)).status).toBe(403);
  });

  it("uploading from a page that is not the back office", async () => {
    const preflight = (origin: string) =>
      fetch(outputs.PhotoUploadUrl, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
    const [fromBackOffice, fromStorefront] = await Promise.all([preflight(outputs.BackOfficeUrl), preflight(outputs.StorefrontUrl)]);

    expect(fromBackOffice.headers.get("access-control-allow-origin")).toBe(outputs.BackOfficeUrl);
    expect(fromStorefront.headers.get("access-control-allow-origin")).toBeNull();
  });
});
