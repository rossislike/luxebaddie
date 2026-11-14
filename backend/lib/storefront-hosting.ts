import { fileURLToPath } from "node:url";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  type CfnDistribution,
  Distribution,
  Function as EdgeFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  OriginBase,
  PriceClass,
  ResponseHeadersPolicy,
  S3OriginAccessControl,
  Signing,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnDelivery, CfnDeliveryDestination, CfnDeliverySource } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketEncryption, type IBucket, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import type { StageConfig } from "./stage-config";

interface LbStorefrontHostingProps {
  config: StageConfig;
}

/**
 * Where the storefront lives: a private S3 bucket holding the site's files,
 * served to shoppers by CloudFront.
 *
 * - The bucket is not public. Only this distribution can read it, so every
 *   request goes through CloudFront and gets HTTPS and the security headers.
 * - Publishing the site (uploading files, clearing CloudFront's cache) is done
 *   by the build in lib/storefront-build.ts, not here.
 * - There is no custom domain yet. Until the domain is registered the site is
 *   served from the distribution's own cloudfront.net address.
 */
export class LbStorefrontHosting extends Construct {
  public readonly bucket: Bucket;
  public readonly distribution: Distribution;
  /** Public address of the storefront. No trailing slash. */
  public readonly url: string;

  constructor(scope: Construct, id: string, props: LbStorefrontHostingProps) {
    super(scope, id);
    const { config } = props;
    const { account } = Stack.of(this);

    // S3 writes the site bucket's own access log into the log bucket. By
    // default the CDK permits that with an ACL; these buckets have ACLs
    // switched off, so permit it with a bucket policy instead.
    this.node.setContext("@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy", true);

    const logBucket = new Bucket(this, "Logs", {
      ...privateBucketDefaults(config),
      lifecycleRules: [{ expiration: config.retainData ? Duration.days(180) : Duration.days(30) }],
    });

    this.bucket = new Bucket(this, "Site", {
      ...privateBucketDefaults(config),
      // Every publish overwrites the site. Keeping replaced files for a while
      // makes it possible to see, or put back, what was live before.
      versioned: true,
      lifecycleRules: [
        { noncurrentVersionExpiration: Duration.days(14), abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: "s3/",
    });

    const originAccess = new S3OriginAccessControl(this, "OriginAccess", { signing: Signing.SIGV4_ALWAYS });

    this.distribution = new Distribution(this, "Distribution", {
      comment: `LuxeBaddie storefront (${config.stage})`,
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: new PrivateBucketOrigin(this.bucket, originAccess),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        // Caches by path alone, for as long as each file's Cache-Control allows
        // (set at upload by the build), and compresses with gzip and Brotli.
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy: this.securityHeaders(config),
        functionAssociations: [{ function: this.pageRouter(), eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      // S3 answers 403, not 404, for a file that does not exist when the
      // reader may not list the bucket. Both mean "no such page".
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 404,
        responsePagePath: "/404.html",
        ttl: Duration.minutes(1),
      })),
      httpVersion: HttpVersion.HTTP2_AND_3,
      // Edge locations in North America and Europe. Orders ship within the US only.
      priceClass: PriceClass.PRICE_CLASS_100,
    });
    this.url = `https://${this.distribution.distributionDomainName}`;

    // Both conditions together admit exactly one reader: this distribution, in this account.
    this.bucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "AllowThisDistributionToReadTheSite",
        principals: [new ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [this.bucket.arnForObjects("*")],
        conditions: {
          StringEquals: { "AWS:SourceArn": this.distribution.distributionArn, "AWS:SourceAccount": account },
        },
      }),
    );

    this.deliverAccessLogs(config, logBucket);
  }

  /**
   * The security headers CloudFront adds to every response.
   *
   * The Content-Security-Policy here carries only `frame-ancestors`. The rest
   * of the policy (which scripts may run, where the browser may connect) is
   * specific to each page, so the storefront build writes it into the page
   * itself: see web/scripts/content-security-policy.mjs.
   */
  private securityHeaders(config: StageConfig): ResponseHeadersPolicy {
    return new ResponseHeadersPolicy(this, "SecurityHeaders", {
      comment: `Security headers for the LuxeBaddie storefront (${config.stage})`,
      securityHeadersBehavior: {
        // Browsers that have visited once refuse plain HTTP for the next two years.
        strictTransportSecurity: { accessControlMaxAge: Duration.days(730), includeSubdomains: true, override: true },
        // Never guess a file's type from its content.
        contentTypeOptions: { override: true },
        // The store may not be embedded in another site's frame (clickjacking).
        // Old browsers read X-Frame-Options, current ones frame-ancestors.
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        contentSecurityPolicy: { contentSecurityPolicy: "frame-ancestors 'none'", override: true },
        // Other sites learn which site a shopper came from, never which page.
        referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          // The store uses none of these device features, so no script on it can either.
          { header: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()", override: true },
          // Pages opened from the store get no handle back to its window.
          { header: "Cross-Origin-Opener-Policy", value: "same-origin", override: true },
        ],
      },
      // Do not advertise what the site is stored on.
      removeHeaders: ["Server"],
    });
  }

  private pageRouter(): EdgeFunction {
    return new EdgeFunction(this, "PageRouter", {
      comment: "Maps clean page addresses to the exported .html files",
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromFile({ filePath: fileURLToPath(new URL("./storefront-page-router.js", import.meta.url)) }),
    });
  }

  /**
   * Access logs: one record per request, written to the log bucket a few
   * minutes later. CloudFront does not charge for delivering them to S3.
   */
  private deliverAccessLogs(config: StageConfig, logBucket: Bucket) {
    const { account, region } = Stack.of(this);
    const name = `luxebaddie-${config.stage}-storefront`;

    const source = new CfnDeliverySource(this, "AccessLogSource", {
      name,
      logType: "ACCESS_LOGS",
      resourceArn: this.distribution.distributionArn,
    });
    const destination = new CfnDeliveryDestination(this, "AccessLogDestination", {
      name,
      destinationResourceArn: logBucket.bucketArn,
      outputFormat: "json",
    });
    const delivery = new CfnDelivery(this, "AccessLogDelivery", {
      deliverySourceName: source.name,
      deliveryDestinationArn: destination.attrArn,
      recordFields: ACCESS_LOG_FIELDS,
    });
    delivery.node.addDependency(source);

    // The log delivery service may write this distribution's logs and nothing else.
    const grant = logBucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "AllowAccessLogDelivery",
        principals: [new ServicePrincipal("delivery.logs.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [logBucket.arnForObjects(`AWSLogs/${account}/CloudFront/*`)],
        conditions: {
          StringEquals: { "s3:x-amz-acl": "bucket-owner-full-control", "aws:SourceAccount": account },
          ArnLike: { "aws:SourceArn": `arn:aws:logs:${region}:${account}:delivery-source:${name}` },
        },
      }),
    );
    if (grant.policyDependable) delivery.node.addDependency(grant.policyDependable);
  }
}

/**
 * What is recorded about each request. Deliberately absent: the query string
 * and the referrer, which on the order confirmation page contain the checkout
 * session id (enough to look that order up), and cookies.
 */
const ACCESS_LOG_FIELDS = [
  "date",
  "time",
  "x-edge-location",
  "c-ip",
  "c-country",
  "cs-method",
  "cs(Host)",
  "cs-uri-stem",
  "cs-protocol",
  "cs-protocol-version",
  "cs(User-Agent)",
  "sc-status",
  "sc-bytes",
  "sc-content-type",
  "time-taken",
  "time-to-first-byte",
  "x-edge-result-type",
  "x-edge-response-result-type",
  "x-edge-detailed-result-type",
  "x-edge-request-id",
  "ssl-protocol",
  "ssl-cipher",
];

/** Encrypted, HTTPS-only, never public, no ACLs. */
function privateBucketDefaults(config: StageConfig) {
  return {
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    encryption: BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
    // Nothing here is the only copy of anything: the site is rebuilt from
    // source and the catalog. Outside production the buckets go with the stack.
    removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    autoDeleteObjects: !config.retainData,
  };
}

/**
 * A private S3 bucket as a CloudFront origin. CloudFront signs each request to
 * S3 (origin access control); the bucket policy decides which distribution is
 * let in.
 */
class PrivateBucketOrigin extends OriginBase {
  constructor(bucket: IBucket, originAccess: S3OriginAccessControl) {
    super(bucket.bucketRegionalDomainName, { originAccessControlId: originAccess.originAccessControlId });
  }

  // Marks the origin as S3 (not a web server). The empty value is the legacy
  // access-identity setting, which origin access control replaces.
  protected renderS3OriginConfig(): CfnDistribution.S3OriginConfigProperty {
    return { originAccessIdentity: "" };
  }
}
