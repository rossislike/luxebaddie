import { Stack } from "aws-cdk-lib";
import { type IPrincipal, WebIdentityPrincipal } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

/** GitHub's token service. The AWS account must already trust it (README, "Automatic deploys"). */
const TOKEN_ISSUER = "token.actions.githubusercontent.com";

/**
 * The one repository whose workflows may sign in, as GitHub names it in its
 * tokens: owner and repository, each followed by its permanent numeric id.
 * The ids stop a different repository that later takes over the same name
 * from signing in. Renaming or transferring the repository changes this value;
 * read the new one with
 *
 *   gh api repos/<owner>/<repository>/actions/oidc/customization/sub --jq .sub_claim_prefix
 */
const REPOSITORY = "repo:rossislike@111800579/luxebaddie@1458066475";

/**
 * Which workflow runs may use a role. GitHub describes each run in its token,
 * and AWS only hands out credentials when the description matches exactly:
 *  - `environment`: jobs that declare this GitHub environment. The environment's
 *    own rules (which branches may deploy to it, required approvals) then apply.
 *  - `branch`: jobs that run on this branch and declare no environment.
 *  - `pullRequest`: jobs that run for a pull request and declare no environment.
 */
export type GitHubRun = { environment: string } | { branch: string } | "pullRequest";

/**
 * GitHub Actions as the party allowed to assume a role, limited to the given
 * runs of this repository. Signing in this way yields credentials that expire
 * within the hour, so there is no AWS key for GitHub to store.
 */
export function githubActions(scope: Construct, run: GitHubRun): IPrincipal {
  const provider = Stack.of(scope).formatArn({
    service: "iam",
    region: "",
    resource: "oidc-provider",
    resourceName: TOKEN_ISSUER,
  });
  return new WebIdentityPrincipal(provider, {
    // Exact matches only. A wildcard here could be satisfied by a run in
    // someone else's repository.
    StringEquals: {
      [`${TOKEN_ISSUER}:aud`]: "sts.amazonaws.com",
      [`${TOKEN_ISSUER}:sub`]: `${REPOSITORY}:${describe(run)}`,
    },
  });
}

function describe(run: GitHubRun): string {
  if (run === "pullRequest") return "pull_request";
  if ("environment" in run) return `environment:${run.environment}`;
  return `ref:refs/heads/${run.branch}`;
}

/**
 * The roles have fixed names because the workflows in .github/workflows refer
 * to them by name. test/unit/github-actions.test.ts checks the two agree.
 */
export function githubRoleNames(stage: string) {
  return {
    /** Deploys the stage. Used by the deploy job. */
    deploy: `luxebaddie-${stage}-github-deploy`,
    /** Reads what is deployed, to show a pull request what it would change. */
    preview: `luxebaddie-${stage}-github-preview`,
    /** Runs the end-to-end tests against the stage. */
    endToEndTests: `luxebaddie-${stage}-github-e2e`,
  };
}
