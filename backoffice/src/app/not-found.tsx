import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-5 pt-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-4 font-display text-4xl">There is no such page</h1>
      <Link href="/" className="btn btn-primary mt-8">
        Back office home
      </Link>
    </main>
  );
}
