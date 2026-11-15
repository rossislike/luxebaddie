import { Duration, Fn, RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  FeaturePlan,
  ManagedLoginVersion,
  Mfa,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import type { StageConfig } from "./stage-config";

interface LbOwnerSignInProps {
  config: StageConfig;
  /** The stage's hosted back office: where an invitation points. No trailing slash. */
  backOfficeUrl: string;
  /**
   * Every address the back office is served from (the hosted one, and a
   * developer's machine on stages that allow it). Cognito only sends a
   * signed-in owner back to one of these. No trailing slashes.
   */
  backOfficeOrigins: string[];
}

/** The back-office pages Cognito returns the owner to. Must match backoffice/src/auth/config.ts. */
const SIGNED_IN_PATH = "/sign-in/callback";
const SIGNED_OUT_PATH = "/signed-out";

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
 * Cognito keeps the passwords and runs the sign-in, on pages it hosts itself
 * (managed login). The back office sends the owner there and gets them back
 * signed in. Nothing in this repository ever sees a password or an
 * authenticator secret.
 */
export class LbOwnerSignIn extends Construct {
  public readonly userPool: UserPool;
  /** The back office, as Cognito knows it. A public client: a browser cannot keep a secret. */
  public readonly client: UserPoolClient;
  /** Where Cognito hosts the sign-in pages. No trailing slash. */
  public readonly pagesUrl: string;
  /** The address the owner's tokens are issued by, from which the back office discovers the sign-in endpoints. */
  public readonly issuer: string;

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
          `You have been invited to the LuxeBaddie back office at ${props.backOfficeUrl} . Sign in there with ` +
          "the email address {username} and this temporary password: {####} You will be asked to choose your " +
          "own password and to set up an authenticator app. The temporary password stops working after three days.",
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
      // The only way the back office signs anyone in: a redirect to Cognito's
      // pages and back (authorization code flow, with PKCE since there is no
      // client secret), asking for who the owner is and nothing more.
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL],
        callbackUrls: props.backOfficeOrigins.map((origin) => `${origin}${SIGNED_IN_PATH}`),
        logoutUrls: props.backOfficeOrigins.map((origin) => `${origin}${SIGNED_OUT_PATH}`),
      },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      // How long one sign-in attempt may take from password to authenticator
      // code. The first one includes installing an authenticator app.
      authSessionValidity: Duration.minutes(15),
      idTokenValidity: OWNER_TOKEN_LIFETIME,
      accessTokenValidity: OWNER_TOKEN_LIFETIME,
      refreshTokenValidity: OWNER_SESSION_LENGTH,
      enableTokenRevocation: true,
      // A wrong email and a wrong password get the same answer, so the sign-in
      // cannot be used to find out which email addresses have an account.
      preventUserExistenceErrors: true,
    });

    const domain = this.userPool.addDomain("SignInPages", {
      cognitoDomain: { domainPrefix: this.signInPagesPrefix(config) },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    // Managed login shows nothing until the client has a style. This is Cognito's default look.
    new CfnManagedLoginBranding(this, "SignInPagesStyle", {
      userPoolId: this.userPool.userPoolId,
      clientId: this.client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    this.pagesUrl = domain.baseUrl();
    this.issuer = this.userPool.userPoolProviderUrl;
  }

  /**
   * The first part of the sign-in pages' address, which has to be unique among
   * every Cognito customer in the region. The stack's own id ends in a random
   * value that never changes, so its first eight characters make the name
   * unique without anyone having to pick one.
   */
  private signInPagesPrefix(config: StageConfig): string {
    const stackUuid = Fn.select(2, Fn.split("/", Stack.of(this).stackId));
    return `luxebaddie-${config.stage}-${Fn.select(0, Fn.split("-", stackUuid))}`;
  }
}
