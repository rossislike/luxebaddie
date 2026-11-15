/**
 * Where the back office signs its owner in: the stage's Cognito user pool.
 * The values come from the stack's outputs (see .env.example).
 */
export type SignInConfig = {
  /** The user pool, as the address its tokens are issued by. Its sign-in endpoints are discovered from here. */
  issuer: string;
  /** The back office, as the user pool knows it. Public: a browser app has no secret. */
  clientId: string;
  /** Where Cognito hosts the sign-in pages. No trailing slash. */
  pagesUrl: string;
};

export function signInConfig(): SignInConfig {
  return {
    issuer: required("NEXT_PUBLIC_SIGN_IN_ISSUER", process.env.NEXT_PUBLIC_SIGN_IN_ISSUER),
    clientId: required("NEXT_PUBLIC_SIGN_IN_CLIENT_ID", process.env.NEXT_PUBLIC_SIGN_IN_CLIENT_ID),
    pagesUrl: required("NEXT_PUBLIC_SIGN_IN_PAGES_URL", process.env.NEXT_PUBLIC_SIGN_IN_PAGES_URL),
  };
}

// Next.js only fills in `process.env.NEXT_PUBLIC_...` where it is written out in full, hence the value argument.
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Copy backoffice/.env.example to backoffice/.env.local.`);
  return value;
}

/** Where Cognito sends the owner back to after signing in, and after signing out. */
export const SIGNED_IN_PATH = "/sign-in/callback";
export const SIGNED_OUT_PATH = "/signed-out";
