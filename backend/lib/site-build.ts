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
import { BUILD_STAMP_PATH, DEPLOYMENT_FINISHED_STATUSES } from "./build-stamp";
import type { LbQueue } from "./queue";
import type { StageConfig } from "./stage-config";
import type { LbSiteHosting, Site } from "./site-hosting";

/** A static site's source: one workspace package of this repository. */
export type SiteSource = Site & {
  /** The package's folder at the repository root, e.g. "web". */
  directory: string;
  /** The package's name, e.g. "@luxebaddie/web". */
  packageName: string;
};

interface LbSiteBuildProps {
  config: StageConfig;
  site: SiteSource;
  hosting: LbSiteHosting;
  /**
   * Addresses and identifiers built into the site's pages (its NEXT_PUBLIC_
   * settings). None of them is a secret: everything here ends up in files
   * anyone can download.
   */
  settings: Record<string, string>;
  /** The Lambda that starts builds. It is told which project to start and allowed to start it. */
  publisher: LambdaFunction;
  /** The publisher's inbox. Anything that makes the live site out of date sends a message here. */
  rebuildQueue: LbQueue;
}

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The files a site's build needs, as .gitignore-style rules: nothing at the
 * top level except the workspace files, the site's own package and the shared
 * packages, and within those no installed dependencies, build output or local
 * settings. Anything else in the repository can change without the site being
 * rebuilt.
 */
const sourceOf = (site: SiteSource) => [
  "/*",
  "!/package.json",
  "!/pnpm-lock.yaml",
  "!/pnpm-workspace.yaml",
  `!/${site.directory}`,
  "!/packages",
  "node_modules",
  ".next",
  `/${site.directory}/out`,
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
 * Builds one of the stage's static sites and puts it live. This is the only
 * way a site is ever published, so what is live always came from the deployed
 * source and, for the storefront, the catalog as it was when the build ran.
 *
 * A build is needed whenever the live site is out of date. Whatever notices
 * that sends a message to the rebuild queue, and the publisher then starts
 * this project, one build at a time. One cause is wired up here because every
 * site shares it: a deployment finished, which may have changed the site's
 * code or the addresses built into it. The stack adds the storefront's other
 * cause, a catalog change.
 */
export class LbSiteBuild extends Construct {
  public readonly project: Project;

  constructor(scope: Construct, id: string, props: LbSiteBuildProps) {
    super(scope, id);
    const { config, site, hosting } = props;

    // Uploaded by `cdk deploy`, so builds always use the source that was deployed.
    const source = new Asset(this, "Source", {
      path: repoRoot,
      exclude: sourceOf(site),
      ignoreMode: IgnoreMode.GIT,
    });

    this.project = new Project(this, "Project", {
      description: `Builds the LuxeBaddie ${site.title} and publishes it (${config.stage})`,
      source: Source.s3({ bucket: source.bucket, path: source.s3ObjectKey }),
      environment: {
        buildImage: LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType: ComputeType.SMALL,
      },
      environmentVariables: {
        ...Object.fromEntries(Object.entries(props.settings).map(([name, value]) => [name, { value }])),
        SITE_BUCKET: { value: hosting.bucket.bucketName },
        DISTRIBUTION_ID: { value: hosting.distribution.distributionId },
      },
      buildSpec: publishSite(site),
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
   * source back, and the live site should follow.
   */
  private rebuildAfterDeployment(rebuildQueue: LbQueue) {
    new Rule(this, "DeploymentFinishedRule", {
      description: "When a deployment of this stack finishes",
      eventPattern: {
        source: ["aws.cloudformation"],
        detailType: ["CloudFormation Stack Status Change"],
        detail: {
          "stack-id": [Stack.of(this).stackId],
          "status-details": { status: DEPLOYMENT_FINISHED_STATUSES },
        },
      },
      targets: [new SqsQueue(rebuildQueue.queue, { deadLetterQueue: rebuildQueue.deadLetterQueue })],
    });
  }
}

/** Writes the build stamp into the built site. CodeBuild provides its start time in milliseconds. */
const recordBuildStart = (exportDir: string) =>
  `node -e 'require("fs").writeFileSync("${exportDir}/${BUILD_STAMP_PATH}", JSON.stringify({ startedAt: new Date(Number(process.env.CODEBUILD_START_TIME)).toISOString() }))'`;

/**
 * The build itself. A phase stops at its first failing command, so nothing is
 * uploaded unless the site built, and the build is only reported as succeeded
 * once the new site is what visitors get.
 */
function publishSite(site: SiteSource): BuildSpec {
  const exportDir = `${site.directory}/out`;
  const bucket = "s3://$SITE_BUCKET";
  return BuildSpec.fromObjectToYaml({
    version: "0.2",
    phases: {
      install: {
        // The Node version the Lambdas and CI use.
        "runtime-versions": { nodejs: 24 },
        commands: [
          // Provides the pnpm version named in package.json.
          "corepack enable",
          `pnpm install --frozen-lockfile --filter "${site.packageName}..."`,
        ],
      },
      build: {
        commands: [
          // Writes the static site to the export folder. The storefront reads the catalog from the API to do it.
          `pnpm --filter ${site.packageName} build`,
          // Records when this build started, on the site itself (lib/build-stamp.ts).
          recordBuildStart(exportDir),

          // 1. New hashed files first: pages only ever point at files that already exist.
          `aws s3 sync ${exportDir}/_next/static ${bucket}/_next/static --cache-control "${CACHE_FOREVER}" --no-progress`,
          // 2. The pages themselves, removing pages that no longer exist (a deleted product).
          `aws s3 sync ${exportDir} ${bucket} --exclude "_next/static/*" --cache-control "${CACHE_UNTIL_NEXT_PUBLISH}" --delete --no-progress`,
          // 3. Clear CloudFront's copies and wait until every edge location serves the new site.
          'INVALIDATION_ID=$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" --query Invalidation.Id --output text)',
          'aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION_ID" --id "$INVALIDATION_ID"',
          // 4. Only now drop the previous build's hashed files: no page refers to them any more.
          `aws s3 sync ${exportDir}/_next/static ${bucket}/_next/static --cache-control "${CACHE_FOREVER}" --delete --no-progress`,
        ],
      },
    },
  });
}
