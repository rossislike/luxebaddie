"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addProduct, productPage } from "@/catalog/api";
import { emptyDraft } from "@/catalog/product-draft";
import { ProductForm } from "@/catalog/product-form";

export default function NewProductPage() {
  const router = useRouter();
  const [draft] = useState(emptyDraft);

  return (
    <>
      <p className="eyebrow">
        <Link href="/catalog">Catalog</Link>
      </p>
      <h1 className="mt-2 mb-8 font-display text-4xl">Add a product</h1>
      <ProductForm
        initial={draft}
        isNew
        saveLabel="Add product"
        onSave={async (product) => {
          await addProduct(product);
          router.replace(productPage(product.id));
        }}
      />
    </>
  );
}
