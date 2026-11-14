import { EVENTS } from "@luxebaddie/contracts";
import { EventBus, Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";
import type { LbQueue } from "./queue";

export class LbEventBus extends Construct {
  public readonly bus: EventBus;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.bus = new EventBus(this, "LbEventBus");
  }

  /**
   * Publish-subscribe: fans CheckoutCompleted (published by the payment
   * service) out to every subscriber's queue. Each subscriber gets its own
   * copy and its own retries, so one failing consumer never blocks another.
   *
   * Future automations (confirmation emails, vendor order forwarding, AI
   * workflows) subscribe here with their own queue; the publisher never changes.
   */
  subscribeToCheckoutCompleted(subscribers: LbQueue[]) {
    const rule = new Rule(this, "CheckoutCompletedRule", {
      eventBus: this.bus,
      description: "When the payment service confirms a paid checkout",
      eventPattern: {
        source: [EVENTS.checkoutCompleted.source],
        detailType: [EVENTS.checkoutCompleted.detailType],
      },
    });
    for (const subscriber of subscribers) {
      // If EventBridge itself cannot deliver, the event lands in the same dead-letter queue.
      rule.addTarget(new SqsQueue(subscriber.queue, { deadLetterQueue: subscriber.deadLetterQueue }));
    }
  }
}
