import { MAX_PHOTO_BYTES } from "@luxebaddie/contracts";
import { startPhotoUpload } from "./api";

/**
 * The longest side a product photo is stored at. A phone camera's photo is
 * twice this and several megabytes; shoppers on phones would wait for all of it.
 */
export const LONGEST_SIDE = 2000;

/** How much detail to keep when saving as JPEG. Past this, files grow and eyes cannot tell. */
const JPEG_QUALITY = 0.85;
const STORED_AS = "image/jpeg";

export type Size = { width: number; height: number };

/** The size to store a photo at: shrunk to fit LONGEST_SIDE, never enlarged, proportions kept. */
export function storedSize({ width, height }: Size): Size {
  const scale = Math.min(1, LONGEST_SIDE / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Thrown with a message that can be shown to the owner as it is. */
export class PhotoProblem extends Error {}

/**
 * Makes a photo ready for the shop: the right way up, no bigger than it needs
 * to be, and a JPEG whatever it started as. This also drops everything else a
 * camera writes into a file, such as where the photo was taken.
 */
async function prepare(file: File): Promise<Blob> {
  let picture: ImageBitmap;
  try {
    picture = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoProblem(`"${file.name}" is not a photo this browser can open. Use a JPEG, PNG or WebP file.`);
  }
  const size = storedSize(picture);
  const canvas = Object.assign(document.createElement("canvas"), size);
  const drawing = canvas.getContext("2d");
  if (!drawing) throw new PhotoProblem("This browser cannot prepare photos. Try another browser.");
  // A see-through background would turn black in a JPEG. Product photos sit on white.
  drawing.fillStyle = "#ffffff";
  drawing.fillRect(0, 0, size.width, size.height);
  drawing.drawImage(picture, 0, 0, size.width, size.height);
  picture.close();

  const prepared = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, STORED_AS, JPEG_QUALITY));
  if (!prepared) throw new PhotoProblem(`"${file.name}" could not be prepared. Try a different file.`);
  if (prepared.size > MAX_PHOTO_BYTES) throw new PhotoProblem(`"${file.name}" is too large even after shrinking. Try a different file.`);
  return prepared;
}

/**
 * Prepares a photo and uploads it. Returns the address it now has on the
 * shop, to be saved into a product's photos.
 */
export async function uploadPhoto(file: File): Promise<string> {
  const photo = await prepare(file);
  const upload = await startPhotoUpload(STORED_AS);

  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
  form.append("file", photo); // storage reads everything after the file as part of it, so the file goes last

  const response = await fetch(upload.uploadUrl, { method: "POST", body: form });
  if (!response.ok) throw new PhotoProblem(`"${file.name}" could not be uploaded. Please try again.`);
  return upload.photoUrl;
}
