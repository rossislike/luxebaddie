import { Duration } from "aws-cdk-lib";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import { FilterCriteria, FilterRule, type IFunction, StartingPosition } from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource, SqsDlq } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

interface LbChangeFeedProps {
  table: ITable;
  /** Only changes to items whose partition key starts with this reach the relay, e.g. "PRODUCT#". */
  keyPrefix: string;
  /** The Lambda that turns each change into an event on the bus. */
  relay: IFunction;
}

/**
 * Feeds one kind of item's changes from the table's change stream to a relay
 * Lambda, which announces them as events.
 *
 * This is how a service both saves data and publishes an event without the
 * two ever disagreeing: it only saves, and the event is derived from the
 * stream's record of that save. Lambda delivers each change in order and
 * retries a failing batch, so nothing is skipped; the price is that a change
 * can be announced more than once.
 */
export class LbChangeFeed extends Construct {
  /** Describes changes the relay gave up on, with where to find them in the stream. Needs attention. */
  public readonly deadLetterQueue: Queue;

  constructor(scope: Construct, id: string, props: LbChangeFeedProps) {
    super(scope, id);

    this.deadLetterQueue = new Queue(this, "DeadLetterQueue", {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
    });

    props.relay.addEventSource(
      new DynamoEventSource(props.table, {
        // From the oldest change still in the stream, so none made while this was being deployed is missed.
        startingPosition: StartingPosition.TRIM_HORIZON,
        filters: [
          FilterCriteria.filter({ dynamodb: { Keys: { PK: { S: FilterRule.beginsWith(props.keyPrefix) } } } }),
        ],
        batchSize: 100,
        // A change that cannot be relayed must not hold up the ones behind it
        // forever: split the batch to isolate it, then set it aside.
        bisectBatchOnError: true,
        retryAttempts: 10,
        onFailure: new SqsDlq(this.deadLetterQueue),
      }),
    );
  }
}
