import { RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, ProjectionType, StreamViewType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { GSI1, GSI2, TTL_ATTRIBUTE } from "../src/table/schema";

interface LbDatabaseProps {
  retainData: boolean;
}

/**
 * One table for the whole application (single-table design). Every entity
 * lives here, told apart by its key prefix and Type attribute. Key attributes
 * have generic names because each entity fills them with something different.
 *
 * The model - entities, key formats and the request that serves each access
 * pattern - is documented in backend/DATA-MODEL.md. Change that first.
 */
export class LbDatabase extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: LbDatabaseProps) {
    super(scope, id);

    this.table = new Table(this, "table", {
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: TTL_ATTRIBUTE,
      // The change stream: an ordered record of every committed write, with the
      // item before and after. Events that announce a write are published from
      // it (see lib/change-feed.ts) so they can never disagree with the table.
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: props.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      deletionProtection: props.retainData,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.retainData },
    });

    // Overloaded indexes: each entity type uses them for a different access
    // pattern, so they also get generic key names. Everything is projected so
    // an index read returns complete items.
    for (const indexName of [GSI1, GSI2]) {
      this.table.addGlobalSecondaryIndex({
        indexName,
        partitionKey: { name: `${indexName}PK`, type: AttributeType.STRING },
        sortKey: { name: `${indexName}SK`, type: AttributeType.STRING },
        projectionType: ProjectionType.ALL,
      });
    }
  }
}
