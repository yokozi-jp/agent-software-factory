import type { ConsumedMessage, WriteActor } from "@agent-software-factory/shared-kernel";
import { Context, type Effect } from "effect";

/**
 * The record of the notification messages that were handled: `processed_message` of the approval schema. The
 * implementation (infrastructure) opens one short transaction per call, with the tenant of the message and the
 * module role (`inTenantTransaction`), so `handleNotification` never holds a transaction while it sends the mail
 * (docs/adr/0041). A failure of the database is a defect.
 */
export class NotificationStore extends Context.Service<
  NotificationStore,
  {
    /** Whether the row of `message` is there. */
    readonly isProcessed: (message: ConsumedMessage, write: WriteActor) => Effect.Effect<boolean>;
    /** Writes the row of `message`; does nothing if it is there. */
    readonly markProcessed: (message: ConsumedMessage, write: WriteActor) => Effect.Effect<void>;
  }
>()("approval/NotificationStore") {}
