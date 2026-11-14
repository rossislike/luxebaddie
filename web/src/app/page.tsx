import Link from "next/link";
import { categories } from "@/catalog/categories";
import { getFeaturedProducts, getProducts } from "@/catalog/queries";
import { ProductGrid } from "@/components/product-card";
import { ProductImage } from "@/components/product-image";

export default async function HomePage() {
  const [featured, products] = await Promise.all([getFeaturedProducts(), getProducts()]);
  const hero = featured[0] ?? products[0];

  return (
    <>
      <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 pt-10 pb-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-10 lg:pt-16">
        <div>
          <p className="eyebrow">Wigs · Weaves · Lashes</p>
          <h1 className="mt-6 font-display text-6xl leading-[0.95] sm:text-7xl lg:text-8xl">
            Hair that enters the room <em className="text-wine">first.</em>
          </h1>
          <p className="mt-8 max-w-md text-lg text-cocoa">
            Melted lace, full bundles and lashes with attitude. Everything you need to look expensive, delivered to
            your door.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link href="/shop/wigs" className="btn btn-primary">
              Shop wigs
            </Link>
            <Link href="/shop" className="btn btn-outline">
              Shop everything
            </Link>
          </div>
        </div>
        {hero && (
          <Link href={`/products/${hero.id}`} className="group relative block aspect-[4/5] overflow-hidden rounded-sm">
            <ProductImage product={hero} className="transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
            <span className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-ink/80 to-transparent p-6 pt-24 text-cream">
              <span className="font-display text-2xl">{hero.name}</span>
              <span className="text-xs tracking-[0.2em] uppercase">Shop now</span>
            </span>
          </Link>
        )}
      </section>

      <section className="bg-blush/60">
        <div className="mx-auto grid max-w-7xl gap-px px-5 py-16 sm:grid-cols-3 lg:px-10">
          {categories.map((category, index) => (
            <Link
              key={category.slug}
              href={`/shop/${category.slug}`}
              className="group flex flex-col justify-between gap-10 border-ink/15 py-8 sm:border-l sm:px-8 sm:first:border-l-0 sm:first:pl-0"
            >
              <p className="eyebrow">0{index + 1}</p>
              <div>
                <h2 className="font-display text-5xl transition-colors group-hover:text-wine">{category.name}</h2>
                <p className="mt-3 text-cocoa">{category.blurb}</p>
                <p className="mt-6 text-xs tracking-[0.2em] uppercase">
                  <span className="link-underline">Shop {category.name.toLowerCase()}</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto max-w-7xl px-5 pt-20 lg:px-10">
          <div className="mb-10 flex items-end justify-between">
            <div>
              <p className="eyebrow">The edit</p>
              <h2 className="mt-3 font-display text-4xl sm:text-5xl">Most wanted</h2>
            </div>
            <Link href="/shop" className="link-underline text-xs tracking-[0.2em] uppercase">
              View all
            </Link>
          </div>
          <ProductGrid products={featured.slice(0, 4)} />
        </section>
      )}
    </>
  );
}
