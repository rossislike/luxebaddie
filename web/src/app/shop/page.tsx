import type { Metadata } from "next";
import { categories } from "@/catalog/categories";
import { getProducts } from "@/catalog/queries";
import { ProductGrid } from "@/components/product-card";

export const metadata: Metadata = { title: "Shop all" };

export default async function ShopPage() {
  const products = await getProducts();

  return (
    <div className="mx-auto max-w-7xl px-5 pt-14 lg:px-10">
      <p className="eyebrow">The collection</p>
      <h1 className="mt-3 font-display text-5xl sm:text-6xl">Shop all</h1>
      {categories.map((category) => {
        const inCategory = products.filter((product) => product.category === category.slug);
        if (inCategory.length === 0) return null;
        return (
          <section key={category.slug} className="mt-16">
            <h2 className="mb-8 border-b border-ink/15 pb-4 font-display text-3xl">{category.name}</h2>
            <ProductGrid products={inCategory} />
          </section>
        );
      })}
    </div>
  );
}
