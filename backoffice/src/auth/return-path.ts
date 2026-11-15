const HOME = "/";

/**
 * The page to open after signing in: the one the owner was on when they were
 * sent to sign in. It travels through the sign-in round trip and comes back as
 * untrusted text, so only a plain path inside the back office is accepted.
 * Anything else (another site, a protocol-relative address) becomes home.
 */
export function safeReturnPath(candidate: unknown): string {
  if (typeof candidate !== "string") return HOME;
  const isLocalPath = candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\");
  return isLocalPath ? candidate : HOME;
}
