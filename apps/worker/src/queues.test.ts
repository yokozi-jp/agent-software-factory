import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { elasticMqClient, uniqueQueueName } from "../test/queue.ts";
import { createNotificationQueues, notificationQueueSettings } from "./queues.ts";

const redrivePolicy = z.object({ deadLetterTargetArn: z.string(), maxReceiveCount: z.number() });

describe("通知メールのキューの設定", () => {
  const sqs = elasticMqClient();

  const attributesOf = async (queueUrl: string) =>
    (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["All"] })))
      .Attributes ?? {};

  it("可視性タイムアウト 180 秒、maxReceiveCount 5 のキューと、それを受ける DLQ を作ること", async () => {
    const name = uniqueQueueName();

    const { queueUrl, dlqUrl } = await createNotificationQueues(sqs, { name });

    const queue = await attributesOf(queueUrl);
    const dlq = await attributesOf(dlqUrl);
    expect(queue["VisibilityTimeout"]).toBe("180");
    const policy = redrivePolicy.parse(JSON.parse(queue["RedrivePolicy"] ?? "null"));
    expect(policy.maxReceiveCount).toBe(5);
    expect(policy.deadLetterTargetArn).toBe(dlq["QueueArn"]);
    expect(dlq["QueueArn"]).toMatch(new RegExp(`:${name}-dlq$`));
  });

  it("保持期間は元のキューが 4 日、DLQ が 14 日の値で設定すること", () => {
    // ElasticMQ では MessageRetentionPeriod は効かない (Issue #347)。値は定数で確かめる。
    expect(notificationQueueSettings.retentionSeconds).toBe(4 * 24 * 60 * 60);
    expect(notificationQueueSettings.dlqRetentionSeconds).toBe(14 * 24 * 60 * 60);
  });

  it("試験のために可視性タイムアウトを縮められること", async () => {
    const { queueUrl, dlqUrl } = await createNotificationQueues(sqs, {
      name: uniqueQueueName(),
      visibilityTimeoutSeconds: 2,
    });

    expect((await attributesOf(queueUrl))["VisibilityTimeout"]).toBe("2");
    expect((await attributesOf(dlqUrl))["VisibilityTimeout"]).toBe("2");
  });
});
