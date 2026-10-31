import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

import type { QueueMessage } from "./poller.ts";

/**
 * The `handler(event)` of the Lambda worker (docs/adr/0013). The queue is a standard queue, so every message that failed
 * goes into `batchItemFailures`, and the ones that succeeded are deleted by Lambda; a failure does not stop the messages
 * after it (a FIFO queue would, docs/adr/0041). Lambda delivers a failed message again after the visibility timeout, and
 * SQS moves it to the DLQ after `maxReceiveCount` deliveries.
 *
 * `handle` is the same function as the ECS worker's. Needs "ReportBatchItemFailures" in the event source mapping.
 */
export function createLambdaHandler(options: {
  readonly handle: (message: QueueMessage) => Promise<void>;
  readonly onError: (error: unknown, messageId: string) => void;
}): (event: SQSEvent) => Promise<SQSBatchResponse> {
  return async (event) => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        await options.handle({ messageId: record.messageId, body: record.body });
      } catch (error) {
        options.onError(error, record.messageId);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}
