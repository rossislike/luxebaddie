"use client";

import type { Product } from "@luxebaddie/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { getProduct, removeProduct, saveProduct } from "@/catalog/api";
import { draftOf } from "@/catalog/product-draft";
import { ProductForm } from "@/catalog/product-form";
import { History } from "@/activity/history";
import { ConfirmButton } from "@/components/confirm-button";
import { LoadState } from "@/components/load-state";
import { messageOf } from "@/lib/api";
import { useLoaded } from "@/lib/use-loaded";

export default function ProductPage() {
  return (
    // Which product to edit comes from the address, which only the browser knows.
    <Suspense>
      <ProductById />
    </Suspense>
  );
}

function ProductById() {
  const id = useSearchParams().get("id") ?? "";
  const loaded = useLoaded(useCallback(() => getProduct(id), [id]));

  return (
    <>
      <p className="eyebrow">
        <Link href="/catalog">Catalog</Link>
      </p>
      <LoadState loaded={loaded}>{(product) => <EditProduct key={product.id} product={product} />}</LoadState>
    </>
  );
}

function EditProduct({ product }: { product: Product }) {
  const router = useRouter();
  const [draft] = useState(() => draftOf(product));
  // Counts saves, so the history below is read again after each one.
  const [savedCount, setSavedCount] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function remove() {
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeProduct(product.id);
      router.replace("/catalog");
    } catch (failure) {
      setRemoveError(messageOf(failure));
      setRemoving(false);
    }
  }

  return (
    <>
      <h1 className="mt-2 mb-8 font-display text-4xl" data-testid="product-name">
        {product.name}
      </h1>
      <ProductForm initial={draft} isNew={false} saveLabel="Save" onSave={async (changed) => {
          await saveProduct(changed);
          setSavedCount((count) => count + 1);
        }}>
        <ConfirmButton className="btn btn-danger" confirmLabel="Click again: remove for good" disabled={removing} onConfirm={() => void remove()}>
          Remove product
        </ConfirmButton>
      </ProductForm>
      {removeError && (
        <p role="alert" className="mt-4 border border-wine/30 bg-blush/50 px-4 py-3 text-sm text-wine">
          {removeError}
        </p>
      )}
      <p className="mt-4 max-w-2xl text-sm text-cocoa">
        Removing a product takes its page off the shop for good. Orders already placed keep their own copy of what was bought. To stop selling it
        for a while instead, save it as a draft.
      </p>
      <div className="mt-10">
        <History key={savedCount} kind="product" id={product.id} />
      </div>
    </>
  );
}
