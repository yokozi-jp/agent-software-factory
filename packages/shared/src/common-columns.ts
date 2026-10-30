import { Context } from "effect";
import { sql } from "kysely";

/** Who writes, with which program, in which call: the values of `*_by`, `*_pgm_cd` and `*_tx_id`. */
export interface WriteActor {
  /** The user id for a screen or an API call; for a batch, the same as `pgmCd` (docs/db/postgresql-keys.md). */
  readonly actor: string;
  /** The program code: a short value that tells the function or the job. */
  readonly pgmCd: string;
  /** The id of the call of the Web API or the batch, unique per call. */
  readonly txId: string;
}

/**
 * The values that the common columns of one transaction take. `at` is read once, when the transaction starts, and is
 * bound as a value; `CURRENT_TIMESTAMP` and triggers are not used (docs/db/postgresql-keys.md).
 */
export interface WriteContext extends WriteActor {
  readonly at: Temporal.Instant;
}

/**
 * The `WriteContext` of the open transaction. `inTenantTransaction` provides it, so the code inside reads the same
 * values for every write.
 */
export class CurrentWrite extends Context.Service<CurrentWrite, WriteContext>()(
  "shared/CurrentWrite",
) {}

/**
 * The common columns of an INSERT: both `created_*` and `updated_*`. `lock_no` is left out: the column default (1)
 * sets it.
 */
export const createdColumns = (ctx: WriteContext) => ({
  created_at: ctx.at.toString(),
  created_by: ctx.actor,
  created_pgm_cd: ctx.pgmCd,
  created_tx_id: ctx.txId,
  updated_at: ctx.at.toString(),
  updated_by: ctx.actor,
  updated_pgm_cd: ctx.pgmCd,
  updated_tx_id: ctx.txId,
});

/**
 * The common columns of an UPDATE: `updated_*` and `lock_no = lock_no + 1`. Use it with the check of `lock_no` in the
 * `WHERE` (`updateWithLock`).
 */
export const updatedColumns = (ctx: WriteContext) => ({
  updated_at: ctx.at.toString(),
  updated_by: ctx.actor,
  updated_pgm_cd: ctx.pgmCd,
  updated_tx_id: ctx.txId,
  lock_no: sql<number>`lock_no + 1`,
});

/**
 * The common columns of a data patch: `patched_*` only. `updated_*` and `lock_no` stay as they are, so the patch is
 * told apart from the work of the system (docs/db/postgresql-keys.md). `patchId` is the number of the ticket.
 */
export const patchedColumns = (ctx: WriteContext, patchId: string) => ({
  patched_at: ctx.at.toString(),
  patched_by: ctx.actor,
  patched_id: patchId,
});
