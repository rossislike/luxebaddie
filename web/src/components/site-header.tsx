import Link from "next/link";
import { categories } from "@/catalog/categories";
import { BagLink } from "./bag-link";
import { LogoMark } from "./logo-mark";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-ink/95 text-cream backdrop-blur short:static">
      <p className="border-b border-cream/10 px-4 py-2 text-center text-xs tracking-[0.15em] text-rose-gold uppercase sm:tracking-[0.2em]">
        {/* The full sentence needs two lines on a phone, so the words it can do without wait for a wider screen. */}
        Free standard shipping <span className="hidden sm:inline">on orders </span>over $150
      </p>
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-5 py-2 xs:gap-4 lg:px-10">
        <nav aria-label="Shop" className="flex gap-3 text-xs tracking-[0.1em] uppercase xs:gap-4 xs:tracking-[0.15em] sm:gap-8 sm:text-sm">
          {categories.map((category) => (
            <Link key={category.slug} href={`/shop/${category.slug}`} className="link-underline tap-target">
              {category.name}
            </Link>
          ))}
        </nav>
        <Link href="/" className="tap-target flex items-center gap-3" aria-label="LuxeBaddie home">
          <LogoMark className="h-12 sm:h-16" />
          <span className="hidden font-display text-2xl tracking-[0.25em] md:inline lg:text-3xl">LUXEBADDIE</span>
        </Link>
        <div className="flex justify-end">
          <BagLink />
        </div>
      </div>
    </header>
  );
}
