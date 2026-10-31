import { Effect } from "effect";
import { sql, type ColumnType, type Insertable } from "kysely";

import { createdColumns, CurrentWrite } from "./common-columns.ts";
import { dbCall } from "./db-call.ts";
import { insertRow } from "./insert-row.ts";
import type { ModuleTx } from "./tenant-transaction.ts";

/** What a receiver needs of a message: the `id` (the key of `processed_message`) and the `tenantId`. */
export interface ConsumedMessage {
  readonly id: string;
  readonly tenantId: string;
}

type Instant = ColumnType<Temporal.Instant, string, string>;

/**
 * `processed_message` of a module's schema, with the columns that `recordProcessedMessage` writes (the template is
 * packages/db/templates/processed_message.sql). It is written here by hand: the generated types of a module are
 * not visible to shared-kernel (docs/adr/0026), and the table is the same in every module.
 */
interface ProcessedMessageTable {
  tenant_id: string;
  message_id: string;
  created_at: Instant;
  created_by: string;
  created_pgm_cd: string;
  created_tx_id: string;
  updated_at: Instant;
  updated_by: string;
  updated_pgm_cd: string;
  updated_tx_id: string;
}

/**
 * Writes the row of `message` in `processed_message` of the module `tx`, in the open transaction: `INSERT … ON CONFLICT
 * DO NOTHING RETURNING`. Returns `true` when the row went in and `false` when it was there already, which means the
 * message was processed before (docs/adr/0029). It runs in the transaction of the caller, so the row commits or rolls
 * back with the caller's writes. `defineConsumer` calls it first; a receiver that calls an external API calls it last
 * (docs/adr/0041).
 */
export const recordProcessedMessage = <K extends ModuleTx>(
  tx: K,
  message: ConsumedMessage,
): Effect.Effect<boolean, never, K["Identifier"] | CurrentWrite> =>
  Effect.gen(function* () {
    const current = yield* CurrentWrite;
    const row: Insertable<ProcessedMessageTable> = {
      tenant_id: message.tenantId,
      message_id: message.id,
      ...createdColumns(current),
    };
    const inserted = yield* dbCall(tx, (trx) =>
      insertRow(
        trx,
        // The module name is one of `ModuleName`; it is quoted as an identifier all the same.
        sql.id(tx.module, "processed_message"),
        row,
        sql`ON CONFLICT (tenant_id, message_id) DO NOTHING RETURNING message_id`,
      ),
    );
    return inserted.rows.length > 0;
  });

/**
 * Whether `processed_message` of the module `tx` has the row of `message`, in the open transaction. The row policy
 * limits the read to the tenant of the transaction; the tenant is in the `WHERE` as well, so the primary key is used.
 */
export const isMessageProcessed = <K extends ModuleTx>(
  tx: K,
  message: ConsumedMessage,
): Effect.Effect<boolean, never, K["Identifier"]> =>
  dbCall(tx, (trx) =>
    sql<{ found: number }>`SELECT 1 AS found FROM ${sql.id(tx.module, "processed_message")}
      WHERE tenant_id = ${message.tenantId} AND message_id = ${message.id}`.execute(trx),
  ).pipe(Effect.map((result) => result.rows.length > 0));
