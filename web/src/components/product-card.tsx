import { type Product, startingPriceCents } from "@luxebaddy/contracts";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { ProductImage } from "./product-image";

export function ProductCard({ product }: { product: Product }) {
  const from = startingPriceCents(product);
  const hasRange = new Set(product.variants.filter((v) => v.active).map((v) => v.priceCents)).size > 1;

  return (
    <Link href={`/products/${product.id}`} className="group block">
      <div className="aspect-[4/5] overflow-hidden rounded-sm bg-sand">
        <ProductImage product={product} className="transition-transform duration-700 ease-out group-hover:scale-[1.04]" />
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-4">
        <h3 className="font-display text-xl leading-snug text-ink">{product.name}</h3>
        {from !== null && (
          <p className="shrink-0 text-sm tracking-wide text-cocoa">
            {hasRange && "From "}
            {formatMoney(from)}
          </p>
        )}
      </div>
      <p className="mt-1 text-sm text-cocoa">{product.tagline}</p>
    </Link>
  );
}

export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-12 lg:grid-cols-4 lg:gap-x-8">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
