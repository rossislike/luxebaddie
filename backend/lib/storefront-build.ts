import { fileURLToPath } from "node:url";
import { Duration, IgnoreMode, RemovalPolicy, Stack } from "aws-cdk-lib";
import { BuildSpec, ComputeType, LinuxArmBuildImage, Project, Source } from "aws-cdk-lib/aws-codebuild";
import { Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { Construct } from "constructs";
import type { LbQueue } from "./queue";
import type { StageConfig } from "./stage-config";
import type { LbStorefrontHosting } from "./storefront-hosting";

interface LbStorefrontBuildProps {
  config: StageConfig;
  hosting: LbStorefrontHosting;
  /** Base URL of the API: the build reads the catalog from it, and the built pages call it from the browser. */
  apiUrl: string;
  /** The storefront microservice. It is told which project to start and allowed to start it. */
  publisher: LambdaFunction;
  /** The publisher's inbox. Anything that makes the live storefront out of date sends a message here. */
  rebuildQueue: LbQueue;
}

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The files a storefront build needs, as .gitignore-style rules: nothing at
 * the top level except the workspace files, the storefront and the shared
 * contracts, and within those no installed dependencies, build output or
 * local settings. Anything else in the repository can change without the
 * storefront being rebuilt.
 */
const STOREFRONT_SOURCE = [
  "/*",
  "!/package.json",
  "!/pnpm-lock.yaml",
  "!/pnpm-workspace.yaml",
  "!/web",
  "!/packages",
  "node_modules",
  ".next",
  "/web/out",
  "next-env.d.ts",
  "*.tsbuildinfo",
  ".env*",
  "!.env.example",
];

/** Files whose name contains a hash of their content: a given address never changes, so browsers may keep it for good. */
const CACHE_FOREVER = "public,max-age=31536000,immutable";
/**
 * Pages and everything else: browsers check back every time, while CloudFront
 * keeps its copy until the next publish clears it.
 */
const CACHE_UNTIL_NEXT_PUBLISH = "public,max-age=0,s-maxage=31536000,must-revalidate";

/**
 * Builds the storefront and puts it live. This is the only way the site is
 * ever published, so what is live always came from the deployed source and the
 * catalog as it was when the build ran.
 *
 * A build is needed whenever the live site is out of date:
 *  - the catalog changed (the stack subscribes the rebuild queue to CatalogChanged), or
 *  - a deployment finished, which may have changed the storefront's code or
 *    the addresses built into it (wired up here).
 * Either sends a message to the rebuild queue; the storefront microservice
 * then starts this project, one build at a time.
 */
export class LbStorefrontBuild extends Construct {
  public readonly project: Project;

  constructor(scope: Construct, id: string, props: LbStorefrontBuildProps) {
    super(scope, id);
    const { config, hosting } = props;

    // Uploaded by `cdk deploy`, so builds always use the source that was deployed.
    const source = new Asset(this, "Source", {
      path: repoRoot,
      exclude: STOREFRONT_SOURCE,
      ignoreMode: IgnoreMode.GIT,
    });

    this.project = new Project(this, "Project", {
      description: `Builds the LuxeBaddie storefront and publishes it (${config.stage})`,
      source: Source.s3({ bucket: source.bucket, path: source.s3ObjectKey }),
      environment: {
        buildImage: LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType: ComputeType.SMALL,
      },
      environmentVariables: {
        NEXT_PUBLIC_API_URL: { value: props.apiUrl },
        NEXT_PUBLIC_SITE_URL: { value: hosting.url },
        SITE_BUCKET: { value: hosting.bucket.bucketName },
        DISTRIBUTION_ID: { value: hosting.distribution.distributionId },
      },
      buildSpec: publishStorefront(),
      // A second build is refused rather than run alongside the first, so an
      // older build can never finish last and overwrite a newer one.
      concurrentBuildLimit: 1,
      timeout: Duration.minutes(15),
      logging: {
        cloudWatch: {
          logGroup: new LogGroup(this, "Logs", {
            retention: config.retainData ? RetentionDays.SIX_MONTHS : RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
          }),
        },
      },
    });

    hosting.bucket.grantReadWrite(this.project);
    hosting.bucket.grantDelete(this.project);
    this.project.addToRolePolicy(
      new PolicyStatement({
        actions: ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
        resources: [hosting.distribution.distributionArn],
      }),
    );

    props.publisher.addEnvironment("BUILD_PROJECT_NAME", this.project.projectName);
    props.publisher.addToRolePolicy(
      new PolicyStatement({ actions: ["codebuild:StartBuild"], resources: [this.project.projectArn] }),
    );

    this.rebuildAfterDeployment(props.rebuildQueue);
  }

  /**
   * CloudFormation announces on the account's default event bus when a
   * deployment of this stack ends. A rollback counts: it puts the previous
   * storefront source back, and the live site should follow.
   */
  private rebuildAfterDeployment(rebuildQueue: LbQueue) {
    new Rule(this, "DeploymentFinishedRule", {
      description: "When a deployment of this stack finishes",
      eventPattern: {
        source: ["aws.cloudformation"],
        detailType: ["CloudFormation Stack Status Change"],
        detail: {
          "stack-id": [Stack.of(this).stackId],
          "status-details": { status: ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"] },
        },
      },
      targets: [new SqsQueue(rebuildQueue.queue, { deadLetterQueue: rebuildQueue.deadLetterQueue })],
    });
  }
}

/**
 * The build itself. A phase stops at its first failing command, so nothing is
 * uploaded unless the site built, and the build is only reported as succeeded
 * once the new site is what shoppers get.
 */
function publishStorefront(): BuildSpec {
  const site = "s3://$SITE_BUCKET";
  return BuildSpec.fromObjectToYaml({
    version: "0.2",
    phases: {
      install: {
        // The Node version the Lambdas and CI use.
        "runtime-versions": { nodejs: 24 },
        commands: [
          // Provides the pnpm version named in package.json.
          "corepack enable",
          'pnpm install --frozen-lockfile --filter "@luxebaddie/web..."',
        ],
      },
      build: {
        commands: [
          // Reads the catalog from the API and writes the static site to web/out.
          "pnpm --filter @luxebaddie/web build",

          // 1. New hashed files first: pages only ever point at files that already exist.
          `aws s3 sync web/out/_next/static ${site}/_next/static --cache-control "${CACHE_FOREVER}" --no-progress`,
          // 2. The pages themselves, removing pages that no longer exist (a deleted product).
          `aws s3 sync web/out ${site} --exclude "_next/static/*" --cache-control "${CACHE_UNTIL_NEXT_PUBLISH}" --delete --no-progress`,
          // 3. Clear CloudFront's copies and wait until every edge location serves the new site.
          'INVALIDATION_ID=$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" --query Invalidation.Id --output text)',
          'aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION_ID" --id "$INVALIDATION_ID"',
          // 4. Only now drop the previous build's hashed files: no page refers to them any more.
          `aws s3 sync web/out/_next/static ${site}/_next/static --cache-control "${CACHE_FOREVER}" --delete --no-progress`,
        ],
      },
    },
  });
}
