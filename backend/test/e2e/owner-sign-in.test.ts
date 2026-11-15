/**
 * End-to-end tests of who gets into the back office on the deployed dev stage:
 * the real API Gateway, its authorizer and the Cognito user pool.
 * Needs AWS credentials for the account.
 *
 *   pnpm test:e2e
 *
 * The signed-in tests invite a throwaway owner, sign in as them with a
 * password and an authenticator code, and delete them again.
 */
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { Order, Product } from "@luxebaddie/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminFetch, getStackOutputs, type StackOutputs } from "../../scripts/lib/aws";
import { AWS_SIGNED_PREFIX, OWNER_SIGNED_IN_PREFIX } from "../../src/shared/back-office";
import { BACK_OFFICE_ROUTES } from "../back-office-routes";
import { codeForKey, signInTemporaryOwner, type TemporaryOwner } from "./owner";

const STAGE = "dev";

let outputs: StackOutputs;

/** Calls a back-office route, filling its placeholders with a value that matches nothing. */
function knock(prefix: string, route: string, headers: Record<string, string> = {}) {
  const [method, path] = route.split(" ") as [string, string];
  return fetch(`${outputs.ApiUrl}${prefix}${path.replace(/\{\w+\}/g, "nobody")}`, { method, headers });
}

beforeAll(async () => {
  outputs = await getStackOutputs(STAGE);
});

describe("a visitor who is not signed in", () => {
  it.each(BACK_OFFICE_ROUTES)("is refused by %s, through either door", async (route) => {
    const [throughOwnerDoor, throughAwsDoor] = await Promise.all([
      knock(OWNER_SIGNED_IN_PREFIX, route),
      knock(AWS_SIGNED_PREFIX, route),
    ]);

    expect([throughOwnerDoor.status, throughAwsDoor.status]).toEqual([401, 403]);
  });

  it.each(BACK_OFFICE_ROUTES)("is refused by %s with a made-up sign-in token", async (route) => {
    // Shaped like a sign-in token, but signed by nobody.
    const part = (claims: object) => Buffer.from(JSON.stringify(claims)).toString("base64url");
    const forged = `${part({ alg: "none" })}.${part({ email: "owner@example.com" })}.`;

    expect((await knock(OWNER_SIGNED_IN_PREFIX, route, { Authorization: `Bearer ${forged}` })).status).toBe(401);
  });

  it("is told so in a way a browser page can read", async () => {
    const refusal = await knock(OWNER_SIGNED_IN_PREFIX, "GET /product", { Origin: "https://anywhere.example" });

    expect(refusal.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("cannot register an account", async () => {
    const signUp = new CognitoIdentityProviderClient({}).send(
      new SignUpCommand({
        ClientId: outputs.OwnerUserPoolClientId,
        Username: "intruder@example.com",
        Password: "Aa1!-a-password-long-enough",
      }),
    );

    await expect(signUp).rejects.toMatchObject({ name: "NotAuthorizedException" });
  });
});

describe("the signed-in owner", () => {
  let owner: TemporaryOwner;
  const asOwner = () => ({ Authorization: `Bearer ${owner.idToken}` });

  beforeAll(async () => {
    owner = await signInTemporaryOwner(outputs);
  });

  afterAll(async () => {
    await owner?.remove();
  });

  it("can read the catalog and the order queue", async () => {
    const [catalog, queue] = await Promise.all([
      knock(OWNER_SIGNED_IN_PREFIX, "GET /product", asOwner()),
      knock(OWNER_SIGNED_IN_PREFIX, "GET /order", asOwner()),
    ]);

    expect([catalog.status, queue.status]).toEqual([200, 200]);
    expect(((await catalog.json()) as { products: Product[] }).products.length).toBeGreaterThan(0);
    expect(Array.isArray(((await queue.json()) as { orders: Order[] }).orders)).toBe(true);
  });

  it("reaches the same functions as an AWS-signed request does", async () => {
    const adminFetch = await createAdminFetch();
    const idsOf = async (response: Response) => ((await response.json()) as { products: Product[] }).products.map((p) => p.id);

    const signedIn = await knock(OWNER_SIGNED_IN_PREFIX, "GET /product", asOwner());
    const awsSigned = await adminFetch(`${outputs.ApiUrl}${AWS_SIGNED_PREFIX}/product`);

    expect(await idsOf(signedIn)).toEqual(await idsOf(awsSigned));
  });

  it("does not get in through the door for AWS-signed requests", async () => {
    expect((await knock(AWS_SIGNED_PREFIX, "GET /product", asOwner())).status).toBe(403);
  });

  it("is asked for an authenticator code at the next sign-in, not just the password", async () => {
    const nextSignIn = await owner.signInWithPasswordOnly();

    expect(nextSignIn.ChallengeName).toBe("SOFTWARE_TOKEN_MFA");
    expect(nextSignIn.AuthenticationResult).toBeUndefined();
  });

  it("can no longer renew the session after signing out everywhere", async () => {
    const renew = () =>
      new CognitoIdentityProviderClient({}).send(
        new InitiateAuthCommand({
          ClientId: outputs.OwnerUserPoolClientId,
          AuthFlow: "REFRESH_TOKEN_AUTH",
          AuthParameters: { REFRESH_TOKEN: owner.refreshToken },
        }),
      );
    expect((await renew()).AuthenticationResult?.IdToken).toBeDefined();

    await owner.signOutEverywhere();

    await expect(renew()).rejects.toMatchObject({ name: "NotAuthorizedException" });
  });
});

describe("the authenticator code helper", () => {
  // RFC 6238, appendix B: the published example for this key, 59 seconds into 1970.
  it("matches the standard's published example", () => {
    expect(codeForKey(Buffer.from("12345678901234567890"), 59_000)).toBe("287082");
  });
});
