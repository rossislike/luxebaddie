/**
 * Invites someone to a stage's back office. Cognito emails them a temporary
 * password; at their first sign-in they choose their own and set up an
 * authenticator app.
 *
 *   pnpm --filter @luxebaddie/backend owner:invite:dev owner@example.com
 *
 * There is no other way to get an account: the back office has no sign-up.
 * Run it again for the same address to send a fresh invitation if the first
 * one expired (after three days).
 */
import {
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { z } from "zod";
import { getStackOutputs, stageFromArgs } from "./lib/aws";

const stage = stageFromArgs();
const email = z.email().safeParse(process.argv[3]);
if (!email.success) throw new Error("Usage: pass the stage and the email address to invite, e.g. `dev owner@example.com`");

const { OwnerUserPoolId, BackOfficeUrl } = await getStackOutputs(stage);
const cognito = new CognitoIdentityProviderClient({});

const invitation = {
  UserPoolId: OwnerUserPoolId,
  Username: email.data,
  // Marked verified because the invitation itself proves the address: only its reader gets the password.
  UserAttributes: [
    { Name: "email", Value: email.data },
    { Name: "email_verified", Value: "true" },
  ],
  DesiredDeliveryMediums: ["EMAIL" as const],
};

try {
  await cognito.send(new AdminCreateUserCommand(invitation));
  console.log(`Invited ${email.data} to the ${stage} back office.`);
} catch (error) {
  if (!(error instanceof UsernameExistsException)) throw error;
  // Only works while the account still has its temporary password, which is exactly when a fresh invitation is wanted.
  await cognito.send(new AdminCreateUserCommand({ ...invitation, MessageAction: "RESEND" }));
  console.log(`${email.data} already had an invitation to the ${stage} back office. Sent it again.`);
}
console.log(`They sign in at ${BackOfficeUrl} with the temporary password from the email.`);
