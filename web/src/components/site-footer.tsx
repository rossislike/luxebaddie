import Link from "next/link";
import { categories } from "@/catalog/categories";

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-ink text-cream">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 py-14 sm:flex-row sm:items-end sm:justify-between lg:px-10">
        <div>
          <p className="font-display text-3xl tracking-[0.25em]">LUXEBADDY</p>
          <p className="mt-3 max-w-sm text-sm text-cream/60">Hair and lashes for the ones who walk in like they own it.</p>
        </div>
        <nav aria-label="Footer" className="flex gap-8 text-sm tracking-[0.15em] uppercase">
          {categories.map((category) => (
            <Link key={category.slug} href={`/shop/${category.slug}`} className="link-underline">
              {category.name}
            </Link>
          ))}
        </nav>
      </div>
      <p className="border-t border-cream/10 px-5 py-5 text-center text-xs tracking-wider text-cream/50">
        © LuxeBaddy. Secure checkout by Stripe.
      </p>
    </footer>
  );
}
