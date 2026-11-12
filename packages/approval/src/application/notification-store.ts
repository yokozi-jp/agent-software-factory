import type { ConsumedMessage } from "@agent-software-factory/shared-kernel/messaging";
import type { WriteContext } from "@agent-software-factory/shared-kernel/tenant-db";
import { Context, type Effect } from "effect";

/**
 * The record of the notification messages that were handled: `processed_message` of the approval schema. The
 * implementation (infrastructure) opens one short transaction per call, with the tenant of the message and the
 * module role (`inTenantTransaction`), so `handleNotification` never holds a transaction while it sends the mail
 * (docs/adr/0041). `write` carries the `now` that the entry file read once for the message, so the two transactions of
 * one message take the same moment for their common columns. A failure of the database is a defect.
 */
export class NotificationStore extends Context.Service<
  NotificationStore,
  {
    /** Whether the row of `message` is there. */
    readonly isProcessed: (message: ConsumedMessage, write: WriteContext) => Effect.Effect<boolean>;
    /** Writes the row of `message`; does nothing if it is there. */
    readonly markProcessed: (message: ConsumedMessage, write: WriteContext) => Effect.Effect<void>;
  }
>()("approval/NotificationStore") {}
