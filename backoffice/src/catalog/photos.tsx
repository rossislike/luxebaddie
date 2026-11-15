"use client";

import { PHOTO_CONTENT_TYPES } from "@luxebaddie/contracts";
import { type ChangeEvent, useId, useState } from "react";
import { messageOf } from "@/lib/api";
import { PhotoProblem, uploadPhoto } from "./photo-upload";

/** As many photos as a product may have (the product contract's limit). */
const MAX_PHOTOS = 12;

/**
 * A product's photos, in order. The first one is the photo the shop shows in
 * listings and on the product page. Uploading only adds to this list: nothing
 * reaches the shop until the product itself is saved.
 */
export function Photos({ images, onChange }: { images: string[]; onChange: (images: string[]) => void }) {
  const [uploading, setUploading] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const inputId = useId();
  const room = MAX_PHOTOS - images.length;

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.target.files ?? [])].slice(0, room);
    event.target.value = ""; // so choosing the same file again is noticed
    setProblems([]);
    setUploading(chosen.length);

    const added: string[] = [];
    const failed: string[] = [];
    // One at a time: a phone on a mobile connection sends one photo faster than four at once.
    for (const file of chosen) {
      try {
        added.push(await uploadPhoto(file));
      } catch (failure) {
        failed.push(failure instanceof PhotoProblem ? failure.message : messageOf(failure));
      }
      setUploading((left) => left - 1);
    }
    if (added.length > 0) onChange([...images, ...added]);
    setProblems(failed);
  }

  const makeFirst = (photo: string) => onChange([photo, ...images.filter((other) => other !== photo)]);
  const remove = (photo: string) => onChange(images.filter((other) => other !== photo));

  return (
    <>
      {images.length === 0 ? (
        <p className="text-cocoa">No photos yet. The shop shows a drawing in their place.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="photos">
          {images.map((photo, index) => (
            <li key={photo}>
              {/* Served as stored from the shop's CDN; the back office is a static export. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt={`Photo ${index + 1}`} loading="lazy" className="aspect-[4/5] w-full bg-sand object-cover" />
              <p className="mt-2 flex flex-wrap gap-x-4 text-sm">
                {index === 0 ? (
                  <span className="flex min-h-11 items-center text-leaf">Shown first</span>
                ) : (
                  <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => makeFirst(photo)}>
                    Show first
                  </button>
                )}
                <button type="button" className="min-h-11 text-wine underline underline-offset-4" onClick={() => remove(photo)}>
                  Remove<span className="sr-only"> photo {index + 1}</span>
                </button>
              </p>
            </li>
          ))}
        </ul>
      )}

      {room > 0 && (
        <div>
          <label htmlFor={inputId} className={`btn btn-outline ${uploading > 0 ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
            {uploading > 0 ? `Uploading ${uploading} ${uploading === 1 ? "photo" : "photos"}...` : "Add photos"}
          </label>
          <input
            id={inputId}
            type="file"
            className="sr-only"
            accept={PHOTO_CONTENT_TYPES.join(",")}
            multiple
            disabled={uploading > 0}
            onChange={(event) => void add(event)}
          />
        </div>
      )}
      <p className="text-sm text-cocoa">
        JPEG, PNG or WebP. Photos are shrunk to fit the shop before they are sent, so a photo straight from a phone is fine. Save the product
        to put added or removed photos on the shop.
      </p>
      {problems.length > 0 && (
        <ul role="alert" className="border border-wine/30 bg-blush/50 px-4 py-3 text-sm text-wine">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </>
  );
}
