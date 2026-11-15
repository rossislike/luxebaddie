"use client";

import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { type Owner, ownerSession } from "./owner-session";

const OwnerContext = createContext<Owner | null>(null);

/** The signed-in owner. Only for components rendered inside SignedInOnly. */
export function useOwner(): Owner {
  const owner = use(OwnerContext);
  if (!owner) throw new Error("useOwner needs a signed-in owner: render it inside SignedInOnly");
  return owner;
}

type Gate = { status: "checking" } | { status: "signed-in"; owner: Owner } | { status: "failed" };

/**
 * Shows its children to a signed-in owner and to nobody else. A visitor
 * without a session is sent to the sign-in page and sees only the line below,
 * which is also all that the published page files contain: the screens are
 * drawn in the browser, after this check.
 *
 * This keeps the screens out of sight. It is the API that keeps the data safe,
 * by refusing every request that lacks a valid sign-in token.
 */
export function SignedInOnly({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const owner = await ownerSession.owner();
      if (cancelled) return;
      if (owner) return setGate({ status: "signed-in", owner });
      await ownerSession.signIn(window.location.pathname + window.location.search);
    })().catch((error) => {
      console.error("Could not start signing in", error);
      if (!cancelled) setGate({ status: "failed" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate.status === "signed-in") return <OwnerContext value={gate.owner}>{children}</OwnerContext>;

  return (
    <main className="mx-auto max-w-xl px-5 pt-24 text-center" data-testid="sign-in-gate">
      {gate.status === "checking" ? (
        <p className="text-cocoa">Taking you to sign-in...</p>
      ) : (
        <>
          <p className="text-wine">We could not reach the sign-in service.</p>
          <button type="button" className="btn btn-primary mt-6" onClick={() => window.location.reload()}>
            Try again
          </button>
        </>
      )}
    </main>
  );
}
