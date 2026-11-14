import Link from "next/link";
import { categories } from "@/catalog/categories";
import { BagLink } from "./bag-link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-cream/90 backdrop-blur">
      <p className="bg-ink px-4 py-2 text-center text-xs tracking-[0.2em] text-cream uppercase">
        Free standard shipping on orders over $150
      </p>
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-4 lg:px-10">
        <nav aria-label="Shop" className="flex gap-5 text-sm tracking-[0.15em] uppercase sm:gap-8">
          {categories.map((category) => (
            <Link key={category.slug} href={`/shop/${category.slug}`} className="link-underline">
              {category.name}
            </Link>
          ))}
        </nav>
        <Link href="/" className="font-display text-2xl tracking-[0.25em] sm:text-3xl" aria-label="LuxeBaddy home">
          LUXEBADDY
        </Link>
        <div className="flex justify-end">
          <BagLink />
        </div>
      </div>
    </header>
  );
}
