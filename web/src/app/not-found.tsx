import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-5 pt-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-4 font-display text-5xl sm:text-6xl">This page slipped away</h1>
      <p className="mt-4 text-cocoa">The page you are looking for is not here, but the good hair still is.</p>
      <Link href="/shop" className="btn btn-primary mt-10">
        Shop the collection
      </Link>
    </div>
  );
}
