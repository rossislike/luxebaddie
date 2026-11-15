import { EVENTS } from "@luxebaddie/contracts";
import { Stack } from "aws-cdk-lib";
import type { RestApi } from "aws-cdk-lib/aws-apigateway";
import type { IUserPool } from "aws-cdk-lib/aws-cognito";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import type { IEventBus } from "aws-cdk-lib/aws-events";
import { PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { itemsWithKeyPrefix } from "./database";
import { githubActions, githubRoleNames } from "./github-actions";
import type { StageConfig } from "./stage-config";

interface LbEndToEndTestAccessProps {
  config: StageConfig;
  api: RestApi;
  eventBus: IEventBus;
  table: ITable;
  ownerUserPool: IUserPool;
}

/**
 * The role GitHub Actions uses to run the end-to-end tests (test/e2e) against
 * this stage after a deployment. Each statement is one thing the tests do, and
 * the role can do nothing else. It cannot deploy, and it cannot read a Stripe
 * key.
 *
 * Only for stages where test products and test orders are acceptable: see
 * `endToEndTestAccess` in lib/stage-config.ts.
 */
export class LbEndToEndTestAccess extends Construct {
  constructor(scope: Construct, id: string, props: LbEndToEndTestAccessProps) {
    super(scope, id);
    const { config, api } = props;
    const { checkoutCompleted } = EVENTS;

    const tester = new Role(this, "Tester", {
      roleName: githubRoleNames(config.stage).endToEndTests,
      description: `GitHub Actions: runs the end-to-end tests against the LuxeBaddie ${config.stage} stage`,
      assumedBy: githubActions(this, { branch: "main" }),
    });

    tester.addToPolicy(
      new PolicyStatement({
        sid: "FindTheStage",
        actions: ["cloudformation:DescribeStacks"],
        resources: [Stack.of(this).stackId],
      }),
    );
    tester.addToPolicy(
      new PolicyStatement({
        sid: "CallTheAdminRoutes",
        actions: ["execute-api:Invoke"],
        resources: [api.arnForExecuteApi("*", "/admin/*", api.deploymentStage.stageName)],
      }),
    );
    // Stands in for the payment service, which announces a paid checkout after
    // a real payment. No other event can be published with this role.
    tester.addToPolicy(
      new PolicyStatement({
        sid: "AnnounceAPaidCheckout",
        actions: ["events:PutEvents"],
        resources: [props.eventBus.eventBusArn],
        conditions: {
          StringEquals: {
            "events:source": checkoutCompleted.source,
            "events:detail-type": checkoutCompleted.detailType,
          },
        },
      }),
    );
    tester.addToPolicy(
      new PolicyStatement({
        sid: "RemoveTheOrdersItCreated",
        actions: ["dynamodb:DeleteItem"],
        resources: [props.table.tableArn],
        conditions: itemsWithKeyPrefix(["ORDER#"]),
      }),
    );
    // The tests invite a throwaway owner, sign in as them and delete them, to
    // prove the back office lets a signed-in owner in. Cognito cannot limit
    // these actions to particular users, so on this stage the role could also
    // reset a real owner's account. It can already call every back-office
    // function through the /admin routes, so that hands it nothing new.
    tester.addToPolicy(
      new PolicyStatement({
        sid: "SignInAsATemporaryOwner",
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminInitiateAuth",
          "cognito-idp:AdminRespondToAuthChallenge",
          "cognito-idp:AdminUserGlobalSignOut",
          "cognito-idp:AdminDeleteUser",
        ],
        resources: [props.ownerUserPool.userPoolArn],
      }),
    );
    // Names and dates of parameters, never their values: enough to tell
    // whether the stage has been connected to Stripe. This action cannot be
    // limited to particular parameters.
    tester.addToPolicy(
      new PolicyStatement({
        sid: "SeeWhetherStripeIsConnected",
        actions: ["ssm:DescribeParameters"],
        resources: ["*"],
      }),
    );
  }
}
