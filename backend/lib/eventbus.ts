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
    this.fanOut(
      { id: "CheckoutCompletedRule", description: "When the payment service confirms a paid checkout", event: EVENTS.checkoutCompleted },
      subscribers,
    );
  }

  /** Fans CatalogChanged (published by the product service) out to every subscriber's queue. */
  subscribeToCatalogChanged(subscribers: LbQueue[]) {
    this.fanOut(
      { id: "CatalogChangedRule", description: "When a product is added, edited or removed", event: EVENTS.catalogChanged },
      subscribers,
    );
  }

  private fanOut(subscription: Subscription, subscribers: LbQueue[]) {
    const { source, detailType } = subscription.event;
    const rule = new Rule(this, subscription.id, {
      eventBus: this.bus,
      description: subscription.description,
      eventPattern: { source: [source], detailType: [detailType] },
    });
    for (const subscriber of subscribers) {
      // If EventBridge itself cannot deliver, the event lands in the same dead-letter queue.
      rule.addTarget(new SqsQueue(subscriber.queue, { deadLetterQueue: subscriber.deadLetterQueue }));
    }
  }
}

type Subscription = { id: string; description: string; event: (typeof EVENTS)[keyof typeof EVENTS] };
