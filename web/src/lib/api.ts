const baseUrl = process.env.NEXT_PUBLIC_API_URL;

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 300;
/** Throttling and "try again shortly" responses. Anything else will not improve on a retry. */
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
/** Repeating these has the same effect as doing them once, so they are safe to retry. */
const IDEMPOTENT_METHODS = new Set(["GET", "PUT", "DELETE"]);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra data the API attached to the error, e.g. the refreshed basket on a 409. */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function apiUrl(path: string): string {
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not set. Copy web/.env.example to web/.env.local.");
  }
  return `${baseUrl}${path}`;
}

type ApiRequest = Omit<RequestInit, "body" | "signal"> & { json?: unknown };

/**
 * Calls the backend API and returns the parsed JSON body, or throws ApiError.
 * Every call has a timeout. Idempotent calls are retried a few times on
 * transient failures, backing off with jitter so many browsers recovering
 * from the same blip do not all retry at the same instant.
 */
export async function apiFetch<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const attempts = IDEMPOTENT_METHODS.has(request.method ?? "GET") ? MAX_ATTEMPTS : 1;

  for (let attempt = 1; ; attempt++) {
    const isLastAttempt = attempt === attempts;
    try {
      const response = await send(path, request);
      if (response.ok) return (await readJson(response)) as T;
      if (isLastAttempt || !TRANSIENT_STATUSES.has(response.status)) throw await toApiError(response);
    } catch (error) {
      // Network failures and timeouts are transient; an ApiError is a real answer.
      if (isLastAttempt || error instanceof ApiError) throw error;
    }
    await sleep(backoffWithJitter(attempt));
  }
}

function send(path: string, { json, ...init }: ApiRequest): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(json !== undefined && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
    }),
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await readJson(response).catch(() => null)) as { message?: string; details?: unknown } | null;
  return new ApiError(response.status, body?.message ?? `Request failed (${response.status})`, body?.details);
}

/** "Full jitter": a random wait up to an exponentially growing ceiling. */
function backoffWithJitter(attempt: number): number {
  return Math.random() * BASE_BACKOFF_MS * 2 ** (attempt - 1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
