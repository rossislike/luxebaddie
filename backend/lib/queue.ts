import { Duration } from "aws-cdk-lib";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

interface LbQueueProps {
  consumer: IFunction;
}

/**
 * A subscriber's inbox: events wait here until the consumer Lambda has
 * processed them, so nothing is lost if the consumer is slow, throttled or
 * broken. Messages that keep failing move to the dead-letter queue.
 */
export class LbQueue extends Construct {
  public readonly queue: Queue;
  /** Anything in here is an event the consumer could not process and needs attention. */
  public readonly deadLetterQueue: Queue;

  constructor(scope: Construct, id: string, props: LbQueueProps) {
    super(scope, id);

    this.deadLetterQueue = new Queue(this, "DeadLetterQueue", {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
    });

    this.queue = new Queue(this, "Queue", {
      // AWS guidance: at least six times the consumer's timeout, so a message
      // still being processed is never handed to a second consumer.
      visibilityTimeout: Duration.seconds(150),
      encryption: QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 5 },
    });

    props.consumer.addEventSource(
      new SqsEventSource(this.queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );
  }
}
