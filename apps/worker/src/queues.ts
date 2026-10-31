import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
  type SQSClientConfig,
} from "@aws-sdk/client-sqs";

const secondsPerDay = 24 * 60 * 60;

/**
 * 通知メールのキューの値 (docs/adr/0041)。可視性タイムアウトは関数のタイムアウト (30 秒) の 6 倍、`maxReceiveCount` は 5、
 * 保持期間は元のキュー 4 日 (既定) と DLQ 14 日 (最大)。ECS の構成でも同じ値を使う。CDK のキューもこの値にする。
 */
export const notificationQueueSettings = {
  visibilityTimeoutSeconds: 180,
  maxReceiveCount: 5,
  retentionSeconds: 4 * secondsPerDay,
  dlqRetentionSeconds: 14 * secondsPerDay,
} as const;

export interface NotificationQueues {
  readonly queueUrl: string;
  readonly dlqUrl: string;
}

/**
 * ElasticMQ に、通知メールのキューとその DLQ を作る (ローカルと CI)。キューは標準キューで、DLQ へは `maxReceiveCount` だけで移す
 * (アプリは DLQ へ送らない、docs/adr/0041)。同じ名前で作り直しても、同じ属性なら同じ URL を返す。
 *
 * 試験では `visibilityTimeoutSeconds` を 1〜2 秒に縮めてよい。ElasticMQ では `MessageRetentionPeriod` は効かないので
 * (ElasticMQ 1.7.1 の調査、Issue #347)、保持期間はローカルでは試せない (値だけ設定する)。
 */
export async function createNotificationQueues(
  sqs: SQSClient,
  options: { readonly name: string; readonly visibilityTimeoutSeconds?: number },
): Promise<NotificationQueues> {
  const settings = notificationQueueSettings;
  const visibilityTimeout = String(
    options.visibilityTimeoutSeconds ?? settings.visibilityTimeoutSeconds,
  );
  const dlq = await sqs.send(
    new CreateQueueCommand({
      QueueName: `${options.name}-dlq`,
      Attributes: {
        VisibilityTimeout: visibilityTimeout,
        MessageRetentionPeriod: String(settings.dlqRetentionSeconds),
      },
    }),
  );
  const dlqUrl = expectReturned(dlq.QueueUrl, "QueueUrl of the DLQ");
  const attributes = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ["QueueArn"] }),
  );
  const dlqArn = expectReturned(attributes.Attributes?.["QueueArn"], "QueueArn of the DLQ");

  const queue = await sqs.send(
    new CreateQueueCommand({
      QueueName: options.name,
      Attributes: {
        VisibilityTimeout: visibilityTimeout,
        MessageRetentionPeriod: String(settings.retentionSeconds),
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: settings.maxReceiveCount,
        }),
      },
    }),
  );
  return { queueUrl: expectReturned(queue.QueueUrl, "QueueUrl"), dlqUrl };
}

function expectReturned(value: string | undefined, what: string): string {
  /* v8 ignore next -- SQS returns the URL and the ARN of a queue it created; the check only narrows the types */
  if (value === undefined) throw new Error(`SQS did not return ${what}`);
  return value;
}

/**
 * SQS の client。`endpoint` を上書きするとき (ElasticMQ) は、`AWS_USE_DUALSTACK_ENDPOINT=true` を SDK がエラーにする
 * ので (ElasticMQ の調査、Issue #347)、設定で false に固定する。ローカルと CI では、この環境変数を渡さない
 * (docs/adr/0041)。
 * 本番 (endpoint なし) は SDK の既定のまま、環境変数に従う。
 */
export function createSqsClient(config: SQSClientConfig = {}): SQSClient {
  return new SQSClient(
    config.endpoint === undefined ? config : { ...config, useDualstackEndpoint: false },
  );
}
