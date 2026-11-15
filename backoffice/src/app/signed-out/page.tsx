"use client";

import { ownerSession } from "@/auth/owner-session";

export default function SignedOutPage() {
  return (
    <main className="mx-auto max-w-xl px-5 pt-24 text-center">
      <p className="eyebrow">LuxeBaddie back office</p>
      <h1 className="mt-4 font-display text-4xl">You are signed out</h1>
      <p className="mt-3 text-cocoa">Close this tab, or sign in again to carry on.</p>
      <button type="button" className="btn btn-primary mt-8" onClick={() => void ownerSession.signIn("/")}>
        Sign in
      </button>
    </main>
  );
}
