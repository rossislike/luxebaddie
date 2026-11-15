"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ownerSession } from "@/auth/owner-session";

/** Where Cognito sends the owner after they have signed in. Finishes the sign-in and opens the page they wanted. */
export default function SignInCallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    ownerSession.completeSignIn().then(
      (returnTo) => router.replace(returnTo),
      (error) => {
        console.error("Could not finish signing in", error);
        setFailed(true);
      },
    );
  }, [router]);

  return (
    <main className="mx-auto max-w-xl px-5 pt-24 text-center">
      {failed ? (
        <>
          <h1 className="font-display text-3xl">That sign-in did not go through</h1>
          <p className="mt-3 text-cocoa">Nothing is wrong with your account. Please start again.</p>
          <button type="button" className="btn btn-primary mt-8" onClick={() => void ownerSession.signIn("/")}>
            Sign in
          </button>
        </>
      ) : (
        <p className="text-cocoa">Signing you in...</p>
      )}
    </main>
  );
}
