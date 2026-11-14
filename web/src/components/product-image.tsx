import type { Product } from "@luxebaddy/contracts";
import { ProductArt } from "./product-art";

/** The product's photo, or generated artwork while no photo exists. */
export function ProductImage({
  product,
  className = "",
}: {
  product: Pick<Product, "id" | "name" | "category" | "images">;
  className?: string;
}) {
  const photo = product.images[0];
  if (!photo) return <ProductArt productId={product.id} category={product.category} className={className} />;
  // Product photos are served as-is from the image CDN; the site is a static export.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={photo} alt={product.name} loading="lazy" className={`h-full w-full object-cover ${className}`} />;
}
