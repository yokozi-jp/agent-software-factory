import { DeleteMessageCommand, ReceiveMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { setTimeout as sleep } from "node:timers/promises";

/** The part of an SQS message that a handler needs. */
export interface QueueMessage {
  readonly messageId: string;
  readonly body: string;
}

export interface PollOptions {
  readonly sqs: SQSClient;
  readonly queueUrl: string;
  /** Handles one message. A rejection leaves the message in the queue, to be delivered again. */
  readonly handle: (message: QueueMessage) => Promise<void>;
  /** Stops the loop: the one in flight ends, and no new message is received. */
  readonly signal: AbortSignal;
  /** Reports a failure of a handler or of SQS. The entry file writes it to stdout. */
  readonly onError: (error: unknown, messageId: string | undefined) => void;
  /** Long polling. SQS allows up to 20 seconds, which is the default here. */
  readonly waitTimeSeconds?: number;
  /** How long to wait after SQS itself fails (a network error), so the loop does not spin. */
  readonly retryDelayMillis?: number;
}

/**
 * The loop of the ECS worker (docs/adr/0013): receive up to 10 messages, handle them one by one and delete each one that
 * succeeded. A message whose handler failed is not deleted. It becomes visible again after the visibility timeout, and
 * SQS moves it to the DLQ after `maxReceiveCount` deliveries (docs/adr/0041); the worker never sends to the DLQ itself.
 * If the delete fails, the message is delivered again, which `processed_message` absorbs.
 *
 * Resolves when `signal` aborts.
 */
export async function pollQueue(options: PollOptions): Promise<void> {
  const { sqs, queueUrl, handle, signal, onError } = options;
  const retryDelayMillis = options.retryDelayMillis ?? 1_000;
  while (!signal.aborted) {
    let received;
    try {
      received = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: options.waitTimeSeconds ?? 20,
        }),
        { abortSignal: signal },
      );
    } catch (error) {
      if (signal.aborted) break;
      onError(error, undefined);
      await sleep(retryDelayMillis, undefined, { signal }).catch(() => undefined);
      continue;
    }
    for (const message of received.Messages ?? []) {
      const { MessageId: messageId, Body: body, ReceiptHandle: receiptHandle } = message;
      /* v8 ignore next 3 -- SQS returns the id, the body and the receipt handle of every message it delivers; the check only narrows the types */
      if (messageId === undefined || body === undefined || receiptHandle === undefined) {
        continue;
      }
      try {
        await handle({ messageId, body });
        await sqs.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
        );
      } catch (error) {
        onError(error, messageId);
      }
    }
  }
}
