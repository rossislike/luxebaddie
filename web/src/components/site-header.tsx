import Link from "next/link";
import { categories } from "@/catalog/categories";
import { BagLink } from "./bag-link";
import { LogoMark } from "./logo-mark";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-ink/95 text-cream backdrop-blur">
      <p className="border-b border-cream/10 px-4 py-2 text-center text-xs tracking-[0.2em] text-rose-gold uppercase">
        Free standard shipping on orders over $150
      </p>
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-2 lg:px-10">
        <nav aria-label="Shop" className="flex gap-4 text-xs tracking-[0.15em] uppercase sm:gap-8 sm:text-sm">
          {categories.map((category) => (
            <Link key={category.slug} href={`/shop/${category.slug}`} className="link-underline">
              {category.name}
            </Link>
          ))}
        </nav>
        <Link href="/" className="flex items-center gap-3" aria-label="LuxeBaddie home">
          <LogoMark className="h-14 sm:h-16" />
          <span className="hidden font-display text-2xl tracking-[0.25em] md:inline lg:text-3xl">LUXEBADDIE</span>
        </Link>
        <div className="flex justify-end">
          <BagLink />
        </div>
      </div>
    </header>
  );
}
