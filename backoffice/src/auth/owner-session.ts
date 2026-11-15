import { type User, UserManager, WebStorageStateStore } from "oidc-client-ts";
import { SIGNED_IN_PATH, SIGNED_OUT_PATH, signInConfig } from "./config";
import { safeReturnPath } from "./return-path";

/**
 * The owner's sign-in session in this browser tab.
 *
 * Signing in happens on pages hosted by Cognito, never here: this module sends
 * the owner there and receives them back (OAuth 2.0 authorization code flow
 * with PKCE, run by the oidc-client-ts library). What comes back is a
 * short-lived token the API accepts, and a longer-lived one used only to fetch
 * the next short-lived token until the session's 12 hours are up.
 *
 * Tokens are kept in sessionStorage: this tab only, gone when it closes.
 */
export type Owner = { email: string };

/** A token this close to expiring is renewed first, so it cannot expire on its way to the API. */
const RENEW_WHEN_SECONDS_LEFT = 60;

let manager: UserManager | undefined;

/** Created on first use: there is no browser to create it in while the pages are being built. */
function userManager(): UserManager {
  const { issuer, clientId } = signInConfig();
  const tabStorage = () => new WebStorageStateStore({ store: window.sessionStorage });
  return (manager ??= new UserManager({
    authority: issuer,
    client_id: clientId,
    redirect_uri: `${window.location.origin}${SIGNED_IN_PATH}`,
    response_type: "code",
    scope: "openid email",
    userStore: tabStorage(),
    stateStore: tabStorage(),
    // Renewal happens when a token is asked for (below), not on a timer that a sleeping tab would miss.
    automaticSilentRenew: false,
  }));
}

const isFresh = (user: User | null): boolean => !!user?.id_token && (user.expires_in ?? 0) > RENEW_WHEN_SECONDS_LEFT;

/** The current session, renewed if it is about to run out. Null when the owner has to sign in again. */
async function currentUser(): Promise<User | null> {
  const user = await userManager().getUser();
  if (isFresh(user)) return user;
  if (!user?.refresh_token) return null;
  try {
    return await userManager().signinSilent();
  } catch {
    // The session ended: its 12 hours are up, or the owner signed out everywhere.
    await userManager().removeUser();
    return null;
  }
}

function ownerOf(user: User): Owner {
  return { email: String(user.profile.email ?? "") };
}

export class SignedOutError extends Error {
  constructor() {
    super("Not signed in");
  }
}

export const ownerSession = {
  async owner(): Promise<Owner | null> {
    const user = await currentUser();
    return user ? ownerOf(user) : null;
  },

  /** The token the API asks for with every back-office request. */
  async token(): Promise<string> {
    const user = await currentUser();
    if (!user?.id_token) throw new SignedOutError();
    return user.id_token;
  },

  /** Leaves for Cognito's sign-in page. `returnTo` is the page to come back to. */
  async signIn(returnTo: string): Promise<void> {
    await userManager().signinRedirect({ state: safeReturnPath(returnTo) });
  },

  /** Finishes a sign-in on the page Cognito sends the owner back to. Returns the page to open next. */
  async completeSignIn(): Promise<string> {
    const user = await userManager().signinRedirectCallback();
    return safeReturnPath(user.state);
  },

  /**
   * Signs out of this tab and of Cognito's own sign-in session, so the next
   * visit asks for the password and the authenticator code again.
   */
  async signOut(): Promise<void> {
    const { clientId, pagesUrl } = signInConfig();
    // Best effort: also end this session's ability to fetch new tokens.
    await userManager()
      .revokeTokens(["refresh_token"])
      .catch(() => {});
    await userManager().removeUser();
    const cognitoSignOut = new URL("/logout", pagesUrl);
    cognitoSignOut.searchParams.set("client_id", clientId);
    cognitoSignOut.searchParams.set("logout_uri", `${window.location.origin}${SIGNED_OUT_PATH}`);
    window.location.assign(cognitoSignOut);
  },
};
