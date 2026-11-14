import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { LbApiGateway } from "./apigateway";
import { LbDatabase } from "./database";
import { LbEventBus } from "./eventbus";
import { LbMicroservices } from "./microservices";
import { LbMonitoring } from "./monitoring";
import { LbQueue } from "./queue";
import type { StageConfig } from "./stage-config";

interface LuxeBaddieStackProps extends StackProps {
  config: StageConfig;
}

export class LuxeBaddieStack extends Stack {
  constructor(scope: Construct, id: string, props: LuxeBaddieStackProps) {
    super(scope, id, props);
    const { config } = props;

    const database = new LbDatabase(this, "Database", { retainData: config.retainData });

    const eventBus = new LbEventBus(this, "EventBus");

    const microservices = new LbMicroservices(this, "Microservices", {
      config,
      table: database.table,
      eventBus: eventBus.bus,
    });

    const apigateway = new LbApiGateway(this, "ApiGateway", {
      config,
      productMicroservice: microservices.productMicroservice,
      basketMicroservice: microservices.basketMicroservice,
      paymentMicroservice: microservices.paymentMicroservice,
      orderingMicroservice: microservices.orderingMicroservice,
    });

    // Each subscriber to CheckoutCompleted has its own queue (and dead-letter queue).
    const orderQueue = new LbQueue(this, "OrderQueue", {
      consumer: microservices.orderingMicroservice,
    });
    const paidBasketQueue = new LbQueue(this, "PaidBasketQueue", {
      consumer: microservices.basketMicroservice,
    });
    eventBus.subscribeToCheckoutCompleted([orderQueue, paidBasketQueue]);

    const monitoring = new LbMonitoring(this, "Monitoring", {
      config,
      api: apigateway.api,
      functions: {
        product: microservices.productMicroservice,
        basket: microservices.basketMicroservice,
        payment: microservices.paymentMicroservice,
        ordering: microservices.orderingMicroservice,
      },
      queues: { order: orderQueue, paidBasket: paidBasketQueue },
    });

    // No trailing slash, so callers can append paths like `${ApiUrl}/product`.
    const { api } = apigateway;
    const apiUrl = `https://${api.restApiId}.execute-api.${this.region}.${this.urlSuffix}/${api.deploymentStage.stageName}`;
    new CfnOutput(this, "ApiUrl", { value: apiUrl });
    new CfnOutput(this, "StripeWebhookUrl", { value: `${apiUrl}/payment/webhook` });
    new CfnOutput(this, "EventBusName", { value: eventBus.bus.eventBusName });
    new CfnOutput(this, "TableName", { value: database.table.tableName });
    new CfnOutput(this, "OrderDeadLetterQueueUrl", { value: orderQueue.deadLetterQueue.queueUrl });
    new CfnOutput(this, "AlarmTopicArn", { value: monitoring.alarmTopic.topicArn });
    new CfnOutput(this, "DashboardName", { value: monitoring.dashboard.dashboardName });
  }
}
