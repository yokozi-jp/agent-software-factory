import { Effect } from "effect";
import { sql } from "kysely";

import { CurrentWrite, type WriteActor } from "../tenant-db/common-columns.ts";
import { dbCall } from "../tenant-db/db-call.ts";
import { Database, inTenantTransaction, type ModuleTx } from "../tenant-db/tenant-transaction.ts";

// The cleanup of expired idempotency keys (Issue #325, docs/adr/0040). A row of `idempotency_key` is kept for 24 hours
// (`expires_at`); this deletes the rows past it, so the table does not grow for ever.

/** How many rows one transaction deletes, unless the caller says otherwise. */
export const DEFAULT_PURGE_BATCH_SIZE = 1000;

export interface PurgeOptions {
  /** The most rows one transaction deletes; the lock is held for that many rows only. 1 or more. */
  readonly batchSize?: number | undefined;
}

export interface PurgeResult {
  /** The rows deleted, over all the transactions. */
  readonly deleted: number;
  /** The transactions that ran, the last one included. */
  readonly batches: number;
}

/**
 * Deletes up to `limit` expired rows of the tenant of the open transaction. The CTE takes the rows in the order of
 * `idx_idempotency_key_tenant_expires_at`, and `FOR UPDATE SKIP LOCKED` leaves out a row that a running request holds (the
 * request deletes an expired row of its own key, or updates its row), so the cleanup never waits for one. The CTE is
 * `MATERIALIZED` and joined with `USING`: with `WHERE … IN (SELECT … LIMIT … FOR UPDATE)` the planner may run the
 * subquery again for each row, and the statement then deletes more than `limit` rows (seen on PostgreSQL 17).
 * The row policy limits the statement to the tenant (docs/adr/0011); the tenant is in the `WHERE` as well.
 */
const deleteExpiredBatch = <K extends ModuleTx>(
  tx: K,
  tenantId: string,
  limit: number,
): Effect.Effect<number, never, K["Identifier"] | CurrentWrite> =>
  Effect.gen(function* () {
    const current = yield* CurrentWrite;
    const table = sql.id(tx.module, "idempotency_key");
    const deleted = yield* dbCall(tx, (trx) =>
      sql`WITH batch AS MATERIALIZED (
            SELECT tenant_id, user_id, idempotency_key FROM ${table}
            WHERE tenant_id = ${tenantId} AND expires_at <= ${current.at.toString()}
            ORDER BY expires_at
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM ${table} AS target USING batch
          WHERE target.tenant_id = batch.tenant_id AND target.user_id = batch.user_id
            AND target.idempotency_key = batch.idempotency_key`.execute(trx),
    );
    return Number(deleted.numAffectedRows ?? 0n);
  });

/**
 * Deletes the expired rows of `idempotency_key` of the module `tx` for one tenant (docs/adr/0011: the job runs per
 * tenant, with the role of the module, never with a role that skips the row policy). Each transaction deletes at most
 * `batchSize` rows and commits, so no lock is held for long; it repeats until a transaction deletes fewer rows than
 * the limit. A run that ends at a row it skipped (a running request holds it) leaves that row for the next run.
 * Call it from the entry file of the batch, not inside a transaction: it opens its own (`inTenantTransaction`).
 */
export const purgeExpiredIdempotencyKeys = <K extends ModuleTx>(
  tx: K,
  scope: { readonly tenantId: string } & WriteActor,
  options: PurgeOptions = {},
): Effect.Effect<PurgeResult, never, Database> =>
  Effect.gen(function* () {
    const batchSize = options.batchSize ?? DEFAULT_PURGE_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      return yield* Effect.die(
        new Error(`batchSize must be an integer of 1 or more: ${batchSize}`),
      );
    }
    let deleted = 0;
    let batches = 0;
    for (;;) {
      const count = yield* inTenantTransaction(
        tx,
        scope,
        deleteExpiredBatch(tx, scope.tenantId, batchSize),
      );
      batches += 1;
      deleted += count;
      if (count < batchSize) return { deleted, batches };
    }
  });
