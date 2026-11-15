import { DefaultStackSynthesizer, Stack, type StackProps } from "aws-cdk-lib";
import { PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { githubActions, githubRoleNames } from "./github-actions";
import { stackNames, type StageConfig } from "./stage-config";

interface LuxeBaddieDeployAccessStackProps extends StackProps {
  config: StageConfig;
}

/**
 * Who may deploy a stage from GitHub, and who may look at what is deployed.
 *
 * This is its own stack, deployed by hand once per stage
 * (`pnpm --filter @luxebaddie/backend deploy-access:dev`), and the pipeline
 * never deploys it: the pipeline does not get to decide who the pipeline is.
 *
 *  - The deploy role is for the deploy job on the stage's GitHub environment,
 *    which GitHub only lets the `main` branch use.
 *  - The preview role is for pull requests. A pull request runs code that has
 *    not been reviewed yet, so this role can read the stage's CloudFormation
 *    template and nothing else.
 */
export class LuxeBaddieDeployAccessStack extends Stack {
  constructor(scope: Construct, id: string, props: LuxeBaddieDeployAccessStackProps) {
    super(scope, id, props);
    const { stage } = props.config;
    const roleNames = githubRoleNames(stage);

    const storeStack = this.formatArn({
      service: "cloudformation",
      resource: "stack",
      resourceName: `${stackNames(stage).store}/*`,
    });

    const deployer = new Role(this, "Deployer", {
      roleName: roleNames.deploy,
      description: `GitHub Actions: deploys the LuxeBaddie ${stage} stage from the main branch`,
      assumedBy: githubActions(this, { environment: stage }),
    });
    // The role holds no deployment permissions of its own. It borrows the roles
    // `cdk bootstrap` created for exactly this, the same ones `cdk deploy` uses
    // from a laptop.
    deployer.addToPolicy(
      new PolicyStatement({
        sid: "DeployThroughTheCdkRoles",
        actions: ["sts:AssumeRole"],
        resources: ["deploy", "file-publishing", "lookup"].map((purpose) => this.cdkBootstrapRole(purpose)),
      }),
    );
    // For scripts/wait-for-storefront.ts, which runs right after the deployment.
    deployer.addToPolicy(
      new PolicyStatement({
        sid: "FollowTheDeployment",
        actions: ["cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents"],
        resources: [storeStack],
      }),
    );

    const previewer = new Role(this, "Previewer", {
      roleName: roleNames.preview,
      description: `GitHub Actions: shows a pull request what it would change in the LuxeBaddie ${stage} stage`,
      assumedBy: githubActions(this, "pullRequest"),
    });
    previewer.addToPolicy(
      new PolicyStatement({
        sid: "ReadTheDeployedTemplate",
        actions: ["cloudformation:GetTemplate", "cloudformation:DescribeStacks"],
        resources: [storeStack],
      }),
    );
  }

  /** One of the roles `cdk bootstrap` created in this account and region. */
  private cdkBootstrapRole(purpose: string): string {
    const qualifier = this.synthesizer.bootstrapQualifier ?? DefaultStackSynthesizer.DEFAULT_QUALIFIER;
    return this.formatArn({
      service: "iam",
      region: "",
      resource: "role",
      resourceName: `cdk-${qualifier}-${purpose}-role-${this.account}-${this.region}`,
    });
  }
}
