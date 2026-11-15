import { RemovalPolicy } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { PHOTO_KEY_PREFIX } from "../src/product/adapters/s3-photo-store";
import type { LbSiteHosting } from "./site-hosting";
import type { StageConfig } from "./stage-config";

interface LbProductPhotosProps {
  config: StageConfig;
  /** The site shoppers see the photos on. They are served from its address, under /media. */
  storefront: LbSiteHosting;
  /** The product microservice: it hands out permissions to upload a photo. */
  uploader: LambdaFunction;
  /** Browser origins photos are uploaded from: the back office. No trailing slashes. */
  uploadOrigins: string[];
}

/**
 * Where product photos live: a private bucket, written to by the back office
 * and read by shoppers through the storefront's CDN.
 *
 * - Nobody reads the bucket directly. The storefront's distribution serves
 *   everything under /media from it, with the same HTTPS and security headers
 *   as the pages.
 * - Nobody writes to it directly either, except with a signed upload form the
 *   product service issues to a signed-in owner: one file, of an agreed kind
 *   and a capped size, to an address the service chose.
 * - It is separate from the site's own bucket on purpose: every publish of
 *   the storefront replaces that bucket's contents.
 */
export class LbProductPhotos extends Construct {
  public readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: LbProductPhotosProps) {
    super(scope, id);
    const { config } = props;

    this.bucket = new Bucket(this, "Photos", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Unlike the sites, photos cannot be rebuilt from anything: where data is
      // kept, they are kept, with earlier versions of a replaced file.
      versioned: config.retainData,
      removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.retainData,
      // The upload is a form post from a page of the back office to S3.
      cors: [{ allowedOrigins: props.uploadOrigins, allowedMethods: [HttpMethods.POST], allowedHeaders: ["*"] }],
    });

    props.storefront.servePrivateBucketAt("/media/*", this.bucket);

    props.uploader.addEnvironment("PHOTO_BUCKET_NAME", this.bucket.bucketName);
    props.uploader.addEnvironment("PHOTO_BASE_URL", props.storefront.url);
    // Uploads are signed with the uploader's own permissions, so this is all a signed form can ever do.
    props.uploader.addToRolePolicy(
      new PolicyStatement({ actions: ["s3:PutObject"], resources: [this.bucket.arnForObjects(`${PHOTO_KEY_PREFIX}*`)] }),
    );
  }

  /** The address the browser uploads to. The back office's pages must be allowed to connect to it. */
  get uploadOrigin(): string {
    return `https://${this.bucket.bucketRegionalDomainName}`;
  }
}
