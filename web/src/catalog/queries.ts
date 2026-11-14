import type { CategorySlug, Product } from "@luxebaddy/contracts";
import { cache } from "react";
import { apiFetch } from "@/lib/api";
import { categories } from "./categories";

/**
 * Catalog reads. These run while the site is being built (and in `next dev`),
 * so product pages ship as static HTML. Publishing a catalog change means
 * rebuilding the storefront. Prices in the bag and at checkout always come
 * live from the API, so a stale page can never produce a wrong charge.
 */
export const getProducts = cache(async (): Promise<Product[]> => {
  const { products } = await apiFetch<{ products: Product[] }>("/product");
  return products.sort(inDisplayOrder);
});

/** The storefront's own order: categories as listed in categories.ts, then each product's position. */
function inDisplayOrder(a: Product, b: Product): number {
  return categoryRank(a.category) - categoryRank(b.category) || a.position - b.position;
}

const categoryRank = (slug: CategorySlug) => categories.findIndex((category) => category.slug === slug);

export async function getProductsByCategory(category: CategorySlug): Promise<Product[]> {
  return (await getProducts()).filter((product) => product.category === category);
}

export async function getFeaturedProducts(): Promise<Product[]> {
  return (await getProducts()).filter((product) => product.featured);
}

export async function getProduct(id: string): Promise<Product | null> {
  return (await getProducts()).find((product) => product.id === id) ?? null;
}
