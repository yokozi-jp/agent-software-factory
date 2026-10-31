import { Data, Effect } from "effect";

import { dbCall } from "./db-call.ts";
import type { ModuleTx } from "./tenant-transaction.ts";

/** The row exists, but its `lock_no` is not the one the client sent: someone updated it first. The API answers 409. */
export class OptimisticLockConflict extends Data.TaggedError("OptimisticLockConflict") {}

/** The row does not exist for this tenant (or at all). The API answers 404. */
export class RowNotFound extends Data.TaggedError("RowNotFound") {}

/**
 * An UPDATE that checks `lock_no` in the `WHERE` (docs/db/postgresql-concurrency.md, the plan 1, and
 * docs/web-api/exclusive-control.md, the plan 3):
 *
 * ```sql
 * UPDATE … SET lock_no = lock_no + 1, updated_* = … WHERE tenant_id = $1 AND <id> = $2 AND lock_no = $3 RETURNING …
 * ```
 *
 * `update` runs that statement (with `updatedColumns`) and returns the first row of `RETURNING`, or `undefined` for
 * zero rows. For zero rows, `exists` runs a SELECT of the row by its key without `lock_no`, in the same transaction:
 * a row means a different `lock_no` (`OptimisticLockConflict`), no row means `RowNotFound`. Another tenant's row is
 * not visible under RLS, so it is `RowNotFound`. How to tell the two is a design choice of this repository, with no
 * source.
 *
 * For a parent and its children, call this for the parent first and compare only the parent's `lock_no`; when only a
 * child changes, raise the parent's `lock_no` too.
 */
export const updateWithLock = <K extends ModuleTx, A>(
  tx: K,
  statements: {
    readonly update: (trx: K["Service"]) => Promise<A | undefined>;
    readonly exists: (trx: K["Service"]) => Promise<boolean>;
  },
): Effect.Effect<A, OptimisticLockConflict | RowNotFound, K["Identifier"]> =>
  Effect.gen(function* () {
    const updated = yield* dbCall(tx, statements.update);
    if (updated !== undefined) return updated;
    const found = yield* dbCall(tx, statements.exists);
    return yield* found ? new OptimisticLockConflict() : new RowNotFound();
  });
