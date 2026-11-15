import { Duration } from "aws-cdk-lib";
import type { RestApi } from "aws-cdk-lib/aws-apigateway";
import type { Distribution } from "aws-cdk-lib/aws-cloudfront";
import type { IProject } from "aws-cdk-lib/aws-codebuild";
import { Alarm, ComparisonOperator, Dashboard, GraphWidget, type IMetric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import type { StageConfig } from "./stage-config";

interface LbMonitoringProps {
  config: StageConfig;
  api: RestApi;
  functions: Record<string, IFunction>;
  /** Subscriber queues by name, each with its dead-letter queue. */
  queues: Record<string, { queue: IQueue; deadLetterQueue: IQueue }>;
  /** Change feeds by name: where changes land that could not be announced as events. */
  changeFeedDeadLetterQueues: Record<string, IQueue>;
  /** The stage's static sites by name, e.g. { Storefront: ..., BackOffice: ... }. */
  sites: Record<string, { title: string; distribution: Distribution; build: IProject }>;
}

/** CloudWatch alarms (sent to an SNS topic) and one dashboard for the whole backend. */
export class LbMonitoring extends Construct {
  public readonly alarmTopic: Topic;
  public readonly dashboard: Dashboard;

  constructor(scope: Construct, id: string, props: LbMonitoringProps) {
    super(scope, id);
    const period = Duration.minutes(5);

    this.alarmTopic = new Topic(this, "AlarmTopic", { displayName: `LuxeBaddie ${props.config.stage} alarms` });
    if (props.config.alarmEmail) {
      this.alarmTopic.addSubscription(new EmailSubscription(props.config.alarmEmail));
    }

    const alarm = (name: string, description: string, metric: IMetric, threshold = 1) => {
      new Alarm(this, name, {
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(this.alarmTopic));
    };

    const queues = Object.entries(props.queues);
    for (const [name, { deadLetterQueue }] of queues) {
      alarm(
        `${name}DeadLetterAlarm`,
        `The ${name} subscriber could not process an event. Inspect its dead-letter queue.`,
        deadLetterQueue.metricApproximateNumberOfMessagesVisible({ period, statistic: "Maximum" }),
      );
    }
    for (const [name, deadLetterQueue] of Object.entries(props.changeFeedDeadLetterQueues)) {
      alarm(
        `${name}ChangeFeedDeadLetterAlarm`,
        `A ${name} change could not be announced as an event. Inspect the change feed's dead-letter queue.`,
        deadLetterQueue.metricApproximateNumberOfMessagesVisible({ period, statistic: "Maximum" }),
      );
    }
    const sites = Object.entries(props.sites);
    for (const [name, { title, distribution, build }] of sites) {
      alarm(
        `${name}BuildFailedAlarm`,
        `A ${title} build failed, so the live ${title} is missing the latest changes. See the build's log.`,
        build.metricFailedBuilds({ period, statistic: "Sum" }),
      );
      alarm(
        `${name}ServerErrorAlarm`,
        `More than 5% of ${title} requests failed with a 5xx error.`,
        distribution.metric5xxErrorRate({ period, statistic: "Average" }),
        5,
      );
    }
    alarm(
      "ApiServerErrorAlarm",
      "The API returned 5xx errors.",
      props.api.metricServerError({ period, statistic: "Sum" }),
      5,
    );
    for (const [name, fn] of Object.entries(props.functions)) {
      alarm(
        `${name}ErrorAlarm`,
        `The ${name} microservice threw errors.`,
        fn.metricErrors({ period, statistic: "Sum" }),
      );
    }

    const functions = Object.entries(props.functions);
    this.dashboard = new Dashboard(this, "Dashboard", { dashboardName: `LuxeBaddie-${props.config.stage}` });
    this.dashboard.addWidgets(
      new GraphWidget({
        title: "API requests and errors",
        left: [props.api.metricCount({ period, statistic: "Sum" })],
        right: [
          props.api.metricClientError({ period, statistic: "Sum" }),
          props.api.metricServerError({ period, statistic: "Sum" }),
        ],
        width: 12,
      }),
      new GraphWidget({
        title: "API latency (p95)",
        left: [props.api.metricLatency({ period, statistic: "p95" })],
        width: 12,
      }),
    );
    this.dashboard.addWidgets(
      new GraphWidget({
        title: "Lambda invocations",
        left: functions.map(([name, fn]) => fn.metricInvocations({ period, statistic: "Sum", label: name })),
        width: 8,
      }),
      new GraphWidget({
        title: "Lambda errors",
        left: functions.map(([name, fn]) => fn.metricErrors({ period, statistic: "Sum", label: name })),
        width: 8,
      }),
      new GraphWidget({
        title: "Lambda duration (p95)",
        left: functions.map(([name, fn]) => fn.metricDuration({ period, statistic: "p95", label: name })),
        width: 8,
      }),
    );
    for (const [, { title, distribution, build }] of sites) {
      this.dashboard.addWidgets(
        new GraphWidget({
          title: `${capitalised(title)} requests and errors`,
          left: [distribution.metricRequests({ period, statistic: "Sum" })],
          right: [
            distribution.metric4xxErrorRate({ period, statistic: "Average" }),
            distribution.metric5xxErrorRate({ period, statistic: "Average" }),
          ],
          width: 12,
        }),
        new GraphWidget({
          title: `${capitalised(title)} builds`,
          left: [
            build.metricSucceededBuilds({ period, statistic: "Sum", label: "succeeded" }),
            build.metricFailedBuilds({ period, statistic: "Sum", label: "failed" }),
          ],
          right: [build.metricDuration({ period, statistic: "Average", label: "duration (s)" })],
          width: 12,
        }),
      );
    }
    this.dashboard.addWidgets(
      new GraphWidget({
        title: "Events received per subscriber",
        left: queues.map(([name, { queue }]) => queue.metricNumberOfMessagesSent({ period, statistic: "Sum", label: name })),
        right: queues.map(([name, { queue }]) =>
          queue.metricApproximateAgeOfOldestMessage({ period, statistic: "Maximum", label: `${name} oldest (s)` }),
        ),
        width: 12,
      }),
      new GraphWidget({
        title: "Dead-letter queues (should stay at 0)",
        left: queues.map(([name, { deadLetterQueue }]) =>
          deadLetterQueue.metricApproximateNumberOfMessagesVisible({ period, statistic: "Maximum", label: name }),
        ),
        width: 12,
      }),
    );
  }
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
