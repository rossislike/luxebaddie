/**
 * Signs in to the stage's back office as a throwaway owner, the way a person
 * would: password first, then a code from an authenticator app. Used by the
 * end-to-end tests; needs the AWS permissions in lib/end-to-end-test-access.ts.
 */
import { createHmac, randomUUID } from "node:crypto";
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminInitiateAuthCommand,
  type AdminInitiateAuthCommandOutput,
  AdminRespondToAuthChallengeCommand,
  AdminSetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  VerifySoftwareTokenCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { StackOutputs } from "../../scripts/lib/aws";

const cognito = new CognitoIdentityProviderClient({});

export type TemporaryOwner = {
  email: string;
  /** What the back office sends with every request. */
  idToken: string;
  /** What the back office exchanges for fresh tokens when the current ones run out. */
  refreshToken: string;
  /** Starts a second sign-in with the password alone. */
  signInWithPasswordOnly(): Promise<AdminInitiateAuthCommandOutput>;
  signOutEverywhere(): Promise<void>;
  remove(): Promise<void>;
};

export async function signInTemporaryOwner(outputs: StackOutputs): Promise<TemporaryOwner> {
  const pool = { UserPoolId: outputs.OwnerUserPoolId };
  const client = { ...pool, ClientId: outputs.OwnerUserPoolClientId };
  // example.com is reserved for tests: no mailbox exists, and no email is sent anyway.
  const email = `e2e-owner-${randomUUID()}@example.com`;
  const password = `Aa1!${randomUUID()}`;
  const user = { ...pool, Username: email };

  const signInWithPasswordOnly = () =>
    cognito.send(
      new AdminInitiateAuthCommand({
        ...client,
        AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    );

  await cognito.send(new AdminCreateUserCommand({ ...user, MessageAction: "SUPPRESS" }));
  await cognito.send(new AdminSetUserPasswordCommand({ ...user, Password: password, Permanent: true }));

  // A new owner has no authenticator yet, so the first sign-in makes them set one up.
  const firstSignIn = await signInWithPasswordOnly();
  if (firstSignIn.ChallengeName !== "MFA_SETUP") {
    throw new Error(`Expected to be asked to set up an authenticator, got ${firstSignIn.ChallengeName ?? "tokens"}`);
  }
  const authenticator = await cognito.send(new AssociateSoftwareTokenCommand({ Session: firstSignIn.Session }));
  const verified = await cognito.send(
    new VerifySoftwareTokenCommand({ Session: authenticator.Session, UserCode: authenticatorCode(authenticator.SecretCode!) }),
  );
  const signedIn = await cognito.send(
    new AdminRespondToAuthChallengeCommand({
      ...client,
      ChallengeName: "MFA_SETUP",
      Session: verified.Session,
      ChallengeResponses: { USERNAME: email },
    }),
  );
  const tokens = signedIn.AuthenticationResult;
  if (!tokens?.IdToken || !tokens.RefreshToken) throw new Error("Signing in did not return tokens");

  return {
    email,
    idToken: tokens.IdToken,
    refreshToken: tokens.RefreshToken,
    signInWithPasswordOnly,
    signOutEverywhere: async () => void (await cognito.send(new AdminUserGlobalSignOutCommand(user))),
    remove: async () => void (await cognito.send(new AdminDeleteUserCommand(user))),
  };
}

const CODE_LIFETIME_MS = 30_000;
const CODE_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The six-digit code an authenticator app shows right now for the secret Cognito handed out. */
export function authenticatorCode(base32Secret: string, now = Date.now()): string {
  return codeForKey(base32Decode(base32Secret), now);
}

/** Time-based one-time password, RFC 6238. */
export function codeForKey(key: Buffer, now: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / CODE_LIFETIME_MS)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** CODE_DIGITS;
  return String(code).padStart(CODE_DIGITS, "0");
}

function base32Decode(text: string): Buffer {
  let bits = "";
  for (const character of text.replace(/=+$/, "").toUpperCase()) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value < 0) throw new Error("Not a base32 secret");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}
