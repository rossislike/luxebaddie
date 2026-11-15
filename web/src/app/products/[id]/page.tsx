import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryBySlug } from "@/catalog/categories";
import { getProduct, getProducts } from "@/catalog/queries";
import { AddToBag } from "@/components/add-to-bag";
import { ProductImage } from "@/components/product-image";

export async function generateStaticParams() {
  return (await getProducts()).map((product) => ({ id: product.id }));
}

export async function generateMetadata({ params }: PageProps<"/products/[id]">): Promise<Metadata> {
  const product = await getProduct((await params).id);
  return product ? { title: product.name, description: product.tagline } : {};
}

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const product = await getProduct((await params).id);
  if (!product) notFound();
  const category = categoryBySlug(product.category);

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-5 pt-6 sm:gap-10 sm:pt-8 lg:grid-cols-2 lg:gap-16 lg:px-10 lg:pt-12">
      {/* Square on a phone, so the name and price are on the first screen instead of a scroll away. */}
      <div className="aspect-square overflow-hidden rounded-sm bg-sand sm:aspect-[4/5] lg:sticky lg:top-32 lg:self-start">
        <ProductImage product={product} />
      </div>

      <div className="lg:py-6">
        {category && (
          <Link href={`/shop/${category.slug}`} className="eyebrow link-underline tap-target">
            {category.name}
          </Link>
        )}
        <h1 className="mt-4 font-display text-4xl leading-tight sm:text-6xl">{product.name}</h1>
        <p className="mt-3 text-lg text-cocoa italic">{product.tagline}</p>

        <AddToBag product={product} />

        <div className="mt-12 border-t border-ink/15 pt-8">
          <p className="leading-relaxed text-cocoa">{product.description}</p>
          {product.highlights.length > 0 && (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {product.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-3 text-sm">
                  <span aria-hidden className="text-gold">
                    ✦
                  </span>
                  {highlight}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
