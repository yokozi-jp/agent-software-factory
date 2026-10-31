import { notificationRequested } from "@agent-software-factory/approval-events";
import type { WriteActor } from "@agent-software-factory/shared-kernel/tenant-db";
import { Effect } from "effect";

import { MailSender } from "./mail-sender.ts";
import { NotificationStore } from "./notification-store.ts";
import { renderNotificationMail } from "./notification-mail.ts";

/**
 * What the entry file gives with each message. `now` is read once per message from the `Clock` (`currentInstant`), so
 * the mail and the test see one moment (docs/adr/0043). `write` is who writes and with which program, for the common
 * columns of `processed_message`.
 */
export interface NotificationContext {
  readonly now: Temporal.Instant;
  readonly write: WriteActor;
}

/** `Sent`: the mail went out and the message is recorded. `Duplicate`: it was recorded before, so nothing was sent. */
export type NotificationResult = { readonly _tag: "Sent" } | { readonly _tag: "Duplicate" };

/**
 * Handles one message of the notification mail queue (review requests and send-backs, docs/adr/0041):
 *
 * 1. Looks for the row of the message in `processed_message` (`NotificationStore`, one short transaction). If it is there, does nothing.
 * 2. Otherwise sends the mail through `MailSender`. No transaction is open while it is sent, so a slow SES holds no
 *    connection or lock.
 * 3. Then writes the row in a second short transaction (`NotificationStore`).
 *
 * The delivery is at least once. If the process stops after step 2 and before step 3, or two workers handle the same
 * message at once, two mails go out; SES `SendEmail` has no idempotency key. The row is written last on purpose: written
 * first, a stop before the send would lose the mail. A failed send is a defect (`MailSendFailed`, the layer dies with it) and writes no
 * row, so the next delivery sends again. A message that does not parse, or lacks an item of its template, is a defect:
 * it can never succeed, so it goes on to the DLQ after `maxReceiveCount` deliveries.
 *
 * `now` is the one moment of this message; `inTenantTransaction` reads the clock again for the common columns of each of
 * its transactions (Issue #506). How this receiver relates to the registry of `defineConsumer` is Issue #505.
 *
 * It does not use `defineConsumer`: that function writes the row first and calls its handler in the same transaction,
 * which holds a transaction open for the whole send.
 */
export const handleNotification = Effect.fn("handleNotification")(function* (
  message: unknown,
  context: NotificationContext,
) {
  const parsed = yield* Effect.sync(() => notificationRequested.schema.parse(message));
  const store = yield* NotificationStore;

  if (yield* store.isProcessed(parsed, context.write)) {
    return { _tag: "Duplicate" } as const satisfies NotificationResult;
  }

  const mail = yield* renderNotificationMail(parsed, context.now);
  const sender = yield* MailSender;
  yield* sender.send(mail);

  yield* store.markProcessed(parsed, context.write);
  return { _tag: "Sent" } as const satisfies NotificationResult;
});
