import {
  handleNotification,
  type MailSender,
  type NotificationStore,
} from "@agent-software-factory/approval";
import { currentInstant } from "@agent-software-factory/shared-kernel";
import { Effect, type ManagedRuntime } from "effect";

import type { QueueMessage } from "./poller.ts";

/** What `handleNotification` needs, which the runtime of an entry file provides. */
export type NotificationRuntime = ManagedRuntime.ManagedRuntime<
  MailSender | NotificationStore,
  never
>;

/**
 * The function that both entry files give the queue: it handles one message of the notification mail queue and rejects
 * when the message must be delivered again (a failed send) or can never succeed (a body that is not JSON, a message that
 * does not parse: a defect, which ends in the DLQ).
 *
 * The body of the message is the event as the Outbox stored it, which the relay sends to the queue as it is (docs/adr/0013,
 * docs/adr/0029); a body wrapped by SNS is not read.
 *
 * The current time is read here, once per message, from the `Clock` of the runtime (`currentInstant`), and passed to the
 * application as `now` (docs/adr/0043). The id of the SQS message is the id of the call for the common columns.
 */
export const createNotificationHandler =
  (runtime: NotificationRuntime) =>
  (message: QueueMessage): Promise<void> =>
    runtime.runPromise(
      Effect.gen(function* () {
        const body = yield* Effect.sync((): unknown => JSON.parse(message.body));
        const now = yield* currentInstant;
        yield* handleNotification(body, {
          now,
          write: {
            actor: "notification-worker",
            pgmCd: "approval.notification",
            txId: message.messageId,
          },
        });
      }),
    );
