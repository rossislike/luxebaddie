"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ownerSession } from "@/auth/owner-session";
import { useOwner } from "@/auth/signed-in-only";

const sections = [{ href: "/", label: "Home" }];

export function OfficeHeader() {
  const owner = useOwner();
  const pathname = usePathname();
  const isCurrent = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="bg-ink text-cream">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3">
        <Link href="/" className="font-display text-xl tracking-[0.2em]">
          LUXEBADDIE <span className="font-sans text-xs tracking-[0.2em] text-rose-gold uppercase">Back office</span>
        </Link>
        <nav aria-label="Back office" className="flex flex-1 gap-1 text-sm">
          {sections.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={isCurrent(href) ? "page" : undefined}
              className="flex min-h-11 items-center px-3 tracking-wide text-cream/70 hover:text-cream aria-[current=page]:text-cream aria-[current=page]:underline aria-[current=page]:underline-offset-8"
            >
              {label}
            </Link>
          ))}
        </nav>
        <p className="flex items-center gap-4 text-sm text-cream/70">
          <span data-testid="owner-email">{owner.email}</span>
          <button type="button" className="min-h-11 underline underline-offset-4 hover:text-cream" onClick={() => void ownerSession.signOut()}>
            Sign out
          </button>
        </p>
      </div>
    </header>
  );
}
