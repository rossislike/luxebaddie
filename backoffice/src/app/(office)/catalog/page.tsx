"use client";

import { CATEGORY_SLUGS, type CategorySlug, formatMoney, type Product, startingPriceCents } from "@luxebaddie/contracts";
import Link from "next/link";
import { listProducts, productPage } from "@/catalog/api";
import { LoadState } from "@/components/load-state";
import { useLoaded } from "@/lib/use-loaded";

const CATEGORY_NAMES: Record<CategorySlug, string> = { wigs: "Wigs", weaves: "Weaves", lashes: "Lashes" };

export default function CatalogPage() {
  const catalog = useLoaded(listProducts);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Catalog</p>
          <h1 className="mt-2 font-display text-4xl">Products</h1>
        </div>
        <Link href="/product/new" className="btn btn-primary">
          Add a product
        </Link>
      </div>
      <div className="mt-8">
        <LoadState loaded={catalog}>
          {(products) =>
            products.length === 0 ? (
              <p className="text-cocoa">There are no products yet. Add the first one.</p>
            ) : (
              <div className="space-y-10">
                {CATEGORY_SLUGS.map((category) => (
                  <Category key={category} name={CATEGORY_NAMES[category]} products={products.filter((product) => product.category === category)} />
                ))}
              </div>
            )
          }
        </LoadState>
      </div>
    </>
  );
}

function Category({ name, products }: { name: string; products: Product[] }) {
  if (products.length === 0) return null;
  // The shop shows a category by position; so does this list, drafts in among the rest.
  const inShopOrder = [...products].sort((a, b) => a.position - b.position);

  return (
    <section>
      <h2 className="font-display text-2xl">{name}</h2>
      <ul className="panel mt-3 divide-y divide-ink/10" data-testid="product-list">
        {inShopOrder.map((product) => (
          <li key={product.id}>
            <Link href={productPage(product.id)} className="grid gap-x-6 gap-y-1 px-5 py-4 hover:bg-sand/50 sm:grid-cols-[1fr_auto_6rem]">
              <span className="min-w-0">
                <span className="block truncate font-medium">{product.name}</span>
                <span className="block text-sm text-cocoa">
                  Position {product.position} · {product.variants.length} {product.variants.length === 1 ? "choice" : "choices"}
                  {product.featured && " · On the home page"}
                </span>
              </span>
              <span className={product.status === "active" ? "text-sm text-leaf" : "text-sm text-cocoa"} data-testid="product-status">
                {product.status === "active" ? "For sale" : "Draft"}
              </span>
              <span className="sm:text-right">{priceOf(product)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function priceOf(product: Product): string {
  const from = startingPriceCents(product);
  return from === null ? "Nothing for sale" : `From ${formatMoney(from)}`;
}
