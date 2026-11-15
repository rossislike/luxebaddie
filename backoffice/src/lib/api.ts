import { ApiError, type ApiFetch, createApiClient } from "@luxebaddie/api-client";
import { ownerSession, SignedOutError } from "@/auth/owner-session";

export { ApiError } from "@luxebaddie/api-client";

/** The back-office routes that accept the signed-in owner (backend/src/shared/back-office.ts). */
const OWNER_ROUTES = "/backoffice";

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new Error("NEXT_PUBLIC_API_URL is not set. Copy backoffice/.env.example to backoffice/.env.local.");
  return `${url}${OWNER_ROUTES}`;
}

const signedFetch = createApiClient({
  baseUrl,
  headers: async () => ({ Authorization: `Bearer ${await ownerSession.token()}` }),
});

const NOT_SIGNED_IN = 401;

/**
 * Calls a back-office route as the signed-in owner, e.g. backOfficeFetch("/order").
 * If the session has ended, sends the owner to sign in and come back to this page.
 */
export const backOfficeFetch: ApiFetch = async (path, request) => {
  try {
    return await signedFetch(path, request);
  } catch (error) {
    const sessionEnded = error instanceof SignedOutError || (error instanceof ApiError && error.status === NOT_SIGNED_IN);
    if (sessionEnded) await ownerSession.signIn(window.location.pathname + window.location.search);
    throw error;
  }
};

/** A message fit to show the owner. The API's own 4xx messages say what is wrong; anything else is on our side. */
export function messageOf(error: unknown): string {
  return error instanceof ApiError && error.status < 500
    ? error.message
    : "Something went wrong on our side. Please try again in a moment.";
}
