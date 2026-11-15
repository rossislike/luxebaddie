import { readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { LuxeBaddieDeployAccessStack } from "../../lib/deploy-access-stack";
import { githubRoleNames } from "../../lib/github-actions";
import { stageConfigFor } from "../../lib/stage-config";

const ACCOUNT = "123456789012";
const roleNames = githubRoleNames("dev");

let template: Template;

beforeAll(() => {
  const stack = new LuxeBaddieDeployAccessStack(new App(), "TestDeployAccess", {
    config: stageConfigFor("dev"),
    env: { account: ACCOUNT, region: "us-east-1" },
  });
  template = Template.fromStack(stack);
});

type Statement = { Sid?: string; Action: string | string[]; Resource: unknown; Condition?: unknown };

function roleNamed(roleName: string) {
  const [found] = Object.entries(template.findResources("AWS::IAM::Role", { Properties: { RoleName: roleName } }));
  if (!found) throw new Error(`No role named ${roleName}`);
  const [logicalId, role] = found;
  const trust = role.Properties.AssumeRolePolicyDocument.Statement;
  const permissions: Statement[] = Object.values(template.findResources("AWS::IAM::Policy"))
    .filter((policy) => JSON.stringify(policy.Properties.Roles).includes(logicalId))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement);
  return { trust, permissions };
}

const workflow = (name: string) => readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8");

describe("deploy access", () => {
  it("creates the two roles and nothing else", () => {
    template.resourceCountIs("AWS::IAM::Role", 2);
    expect(Object.keys(template.toJSON().Resources).every((id) => /^(Deployer|Previewer)/.test(id))).toBe(true);
  });

  it("lets only this repository's dev environment deploy", () => {
    const { trust } = roleNamed(roleNames.deploy);

    expect(trust).toHaveLength(1);
    expect(trust[0]).toMatchObject({
      Effect: "Allow",
      Action: "sts:AssumeRoleWithWebIdentity",
      Condition: {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:rossislike@111800579/luxebaddie@1458066475:environment:dev",
        },
      },
    });
    expect(JSON.stringify(trust[0].Principal)).toContain(`:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`);
  });

  it("lets the deployer use the CDK's own roles and follow the deployment, nothing more", () => {
    const { permissions } = roleNamed(roleNames.deploy);
    const bySid = Object.fromEntries(permissions.map((statement) => [statement.Sid, statement]));

    expect(Object.keys(bySid).sort()).toEqual(["DeployThroughTheCdkRoles", "FollowTheDeployment"]);

    expect(bySid.DeployThroughTheCdkRoles?.Action).toBe("sts:AssumeRole");
    const cdkRoles = JSON.stringify(bySid.DeployThroughTheCdkRoles?.Resource);
    for (const purpose of ["deploy", "file-publishing", "lookup"]) {
      expect(cdkRoles).toContain(`:role/cdk-hnb659fds-${purpose}-role-${ACCOUNT}-us-east-1`);
    }
    expect(cdkRoles).not.toContain("*");

    expect(bySid.FollowTheDeployment?.Action).toEqual(["cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents"]);
    expect(JSON.stringify(bySid.FollowTheDeployment?.Resource)).toContain(":stack/LuxeBaddie-dev/*");
  });

  it("lets a pull request read dev's deployed template and nothing else", () => {
    const { trust, permissions } = roleNamed(roleNames.preview);

    expect(trust[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"]).toBe(
      "repo:rossislike@111800579/luxebaddie@1458066475:pull_request",
    );
    expect(permissions).toHaveLength(1);
    expect(permissions[0]?.Action).toEqual(["cloudformation:GetTemplate", "cloudformation:DescribeStacks"]);
    expect(JSON.stringify(permissions[0]?.Resource)).toContain(":stack/LuxeBaddie-dev/*");
  });

  it("is what the workflows sign in with", () => {
    const deploy = workflow("deploy.yml");

    expect(deploy).toContain(`:role/${roleNames.deploy}\n`);
    expect(deploy).toContain(`:role/${roleNames.endToEndTests}\n`);
    expect(workflow("infrastructure-diff.yml")).toContain(`:role/${roleNames.preview}\n`);
  });
});
