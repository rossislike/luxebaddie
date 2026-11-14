import { Duration } from "aws-cdk-lib";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

interface LbQueueProps {
  consumer: IFunction;
  /**
   * Hand the consumer everything that arrives within this window as one batch,
   * for consumers that do one piece of work per batch rather than per message.
   * By default messages are delivered as soon as they arrive.
   */
  collectFor?: Duration;
  /** Deliveries a message gets before it moves to the dead-letter queue. */
  maxReceiveCount?: number;
}

/** Six times the consumers' 25 second timeout (lib/microservices.ts). */
const CONSUMER_PROCESSING_ALLOWANCE = Duration.seconds(150);

/** The most messages SQS hands a Lambda at once without a collection window. */
const DEFAULT_BATCH_SIZE = 10;
const COLLECTED_BATCH_SIZE = 100;

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
      // AWS guidance: at least six times the consumer's timeout, plus any
      // collection window, so a message still being processed is never handed
      // to a second consumer.
      visibilityTimeout: CONSUMER_PROCESSING_ALLOWANCE.plus(props.collectFor ?? Duration.seconds(0)),
      encryption: QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: props.maxReceiveCount ?? 5 },
    });

    props.consumer.addEventSource(
      new SqsEventSource(this.queue, {
        batchSize: props.collectFor ? COLLECTED_BATCH_SIZE : DEFAULT_BATCH_SIZE,
        maxBatchingWindow: props.collectFor,
        reportBatchItemFailures: true,
      }),
    );
  }
}
