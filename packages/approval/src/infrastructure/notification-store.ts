// idempotency-exempt: a consumer of the notification queue, not an HTTP request; processed_message deduplicates it (docs/adr/0029, docs/async/idempotency.md)
import {
  CurrentWrite,
  Database,
  inTenantTransaction,
  type WriteActor,
} from "@agent-software-factory/shared-kernel/tenant-db";
import {
  isMessageProcessed,
  recordProcessedMessage,
  type ConsumedMessage,
} from "@agent-software-factory/shared-kernel/messaging";
import { Effect, Layer } from "effect";

import { NotificationStore } from "../application/notification-store.ts";
import { ApprovalTx } from "./transaction.ts";

/**
 * `NotificationStore` on the `processed_message` of the approval schema. Each call is one short transaction of the
 * approval module with the tenant of the message set. It takes the pool from `Database` when the layer is built, so
 * the methods need nothing more.
 */
export const NotificationStoreLayer: Layer.Layer<NotificationStore, never, Database> = Layer.effect(
  NotificationStore,
  Effect.gen(function* () {
    const database = yield* Database;
    const inTransaction = <A>(
      message: ConsumedMessage,
      write: WriteActor,
      work: Effect.Effect<A, never, (typeof ApprovalTx)["Identifier"] | CurrentWrite>,
    ) =>
      inTenantTransaction(ApprovalTx, { tenantId: message.tenantId, ...write }, work).pipe(
        Effect.provideService(Database, database),
      );
    return NotificationStore.of({
      isProcessed: (message, write) =>
        inTransaction(message, write, isMessageProcessed(ApprovalTx, message)),
      markProcessed: (message, write) =>
        inTransaction(message, write, recordProcessedMessage(ApprovalTx, message)).pipe(
          Effect.asVoid,
        ),
    });
  }),
);
