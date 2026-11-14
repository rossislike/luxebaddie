import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categories, categoryBySlug } from "@/catalog/categories";
import { getProductsByCategory } from "@/catalog/queries";
import { ProductGrid } from "@/components/product-card";

export function generateStaticParams() {
  return categories.map((category) => ({ category: category.slug }));
}

export async function generateMetadata({ params }: PageProps<"/shop/[category]">): Promise<Metadata> {
  const category = categoryBySlug((await params).category);
  return category ? { title: category.name, description: category.blurb } : {};
}

export default async function CategoryPage({ params }: PageProps<"/shop/[category]">) {
  const category = categoryBySlug((await params).category);
  if (!category) notFound();
  const products = await getProductsByCategory(category.slug);

  return (
    <div className="mx-auto max-w-7xl px-5 pt-14 lg:px-10">
      <p className="eyebrow">Shop</p>
      <h1 className="mt-3 font-display text-5xl sm:text-6xl">{category.name}</h1>
      <p className="mt-4 max-w-xl text-lg text-cocoa">{category.blurb}</p>
      <div className="mt-12">
        {products.length > 0 ? <ProductGrid products={products} /> : <p className="text-cocoa">New arrivals are on the way.</p>}
      </div>
    </div>
  );
}
