import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { AccountRecovery, FeaturePlan, Mfa, UserPool, UserPoolClient } from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import type { StageConfig } from "./stage-config";

interface LbOwnerSignInProps {
  config: StageConfig;
}

/**
 * How long the owner stays signed in. After this they sign in again, second
 * step included.
 */
export const OWNER_SESSION_LENGTH = Duration.hours(12);

/**
 * How long the API accepts one sign-in token before the back office has to
 * fetch a fresh one. It is also the longest a session can keep working after
 * "sign out everywhere": that stops new tokens being issued, and the ones
 * already issued run out within this time.
 */
export const OWNER_TOKEN_LIFETIME = Duration.minutes(15);

/**
 * Who may use the back office: the store owner, signing in with Amazon Cognito.
 *
 * - Nobody can register. Accounts exist only because someone with access to
 *   this AWS account invited them.
 * - Every sign-in needs a second step from an authenticator app. Text-message
 *   and email codes are switched off: both can be intercepted or redirected.
 * - Sessions end on their own (OWNER_SESSION_LENGTH), and all of a user's
 *   sessions can be ended at once.
 *
 * Cognito keeps the passwords and runs the sign-in. Nothing in this repository
 * ever sees a password or an authenticator secret.
 */
export class LbOwnerSignIn extends Construct {
  public readonly userPool: UserPool;
  /** The back office, as Cognito knows it. A public client: a browser cannot keep a secret. */
  public readonly client: UserPoolClient;

  constructor(scope: Construct, id: string, props: LbOwnerSignInProps) {
    super(scope, id);
    const { config } = props;

    this.userPool = new UserPool(this, "Owners", {
      userPoolName: `luxebaddie-${config.stage}-owners`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      mfa: Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false, email: false },
      passwordPolicy: { minLength: 14, tempPasswordValidity: Duration.days(3) },
      // A forgotten password is reset by email. A lost authenticator is not
      // something the owner can reset alone: see README, "Back-office sign-in".
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      featurePlan: FeaturePlan.ESSENTIALS,
      userInvitation: {
        emailSubject: `Your LuxeBaddie back office account (${config.stage})`,
        emailBody:
          "You have been invited to the LuxeBaddie back office. Sign in with the email address {username} " +
          "and this temporary password: {####} You will be asked to choose your own password and to set up " +
          "an authenticator app. The temporary password stops working after three days.",
      },
      deletionProtection: config.retainData,
      removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.client = this.userPool.addClient("BackOffice", {
      userPoolClientName: "back-office",
      generateSecret: false,
      authFlows: {
        userSrp: true,
        // Password sign-in through the AWS API, which needs AWS credentials as
        // well as the password. Only the end-to-end tests use it, to sign in
        // as a temporary owner, so it is off wherever they do not run.
        adminUserPassword: config.endToEndTestAccess,
      },
      // The browser sign-in pages arrive with the back-office site.
      disableOAuth: true,
      idTokenValidity: OWNER_TOKEN_LIFETIME,
      accessTokenValidity: OWNER_TOKEN_LIFETIME,
      refreshTokenValidity: OWNER_SESSION_LENGTH,
      enableTokenRevocation: true,
      // A wrong email and a wrong password get the same answer, so the sign-in
      // cannot be used to find out which email addresses have an account.
      preventUserExistenceErrors: true,
    });
  }
}
