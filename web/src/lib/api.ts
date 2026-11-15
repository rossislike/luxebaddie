import { createApiClient } from "@luxebaddie/api-client";

export { ApiError } from "@luxebaddie/api-client";

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new Error("NEXT_PUBLIC_API_URL is not set. Copy web/.env.example to web/.env.local.");
  return url;
}

/** Calls the backend API. Timeouts, retries and errors are handled by the shared client. */
export const apiFetch = createApiClient({ baseUrl });
