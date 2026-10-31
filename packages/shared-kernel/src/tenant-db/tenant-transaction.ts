import { Context, Effect, Exit, Layer } from "effect";
import { sql, type ControlledTransaction, type Kysely, type QueryExecutorProvider } from "kysely";

import { CurrentWrite, type WriteActor } from "./common-columns.ts";
import { currentInstant } from "../time/time.ts";

/** The modules of the sample feature, by their schema names (GLOSSARY.md, docs/adr/0026). */
export type ModuleName = "claim" | "approval" | "closing";

// The allowlist of the names that reach the SQL: `moduleRole` puts the role into `SET LOCAL ROLE` with `sql.id`, and
// processed-message.ts the schema into a table name. Kysely neither checks nor escapes what `sql.id` gets ("Using this with
// unchecked inputs WILL lead to SQL injection", kysely's sql.d.ts), so keep this list even though shared-kernel then knows
// the names of the modules: deriving the role from the name of a module's Tx alone would drop the check. A module whose Tx
// has a name not here does not type-check (docs/domain-model/add-module.md).
const moduleRoles: Readonly<Record<ModuleName, string>> = {
  claim: "claim_module",
  approval: "approval_module",
  closing: "closing_module",
};

function moduleRole(module: ModuleName): string {
  // The type forbids other names; a value from outside the type system stops here, before the SQL.
  if (!Object.hasOwn(moduleRoles, module)) throw new Error(`Unknown module: ${module}`);
  return moduleRoles[module];
}

export interface TenantScope {
  /** The module whose tables the transaction writes: one module per transaction (docs/adr/0029). */
  readonly module: ModuleName;
  /** The tenant, from the server-side session only (docs/adr/0011). */
  readonly tenantId: string;
}

/**
 * Starts a transaction with the tenant set for RLS (docs/adr/0011) and returns it; the caller commits or rolls back.
 * The setting is `set_config('app.current_tenant', …, true)`, the same as `SET LOCAL`: it ends with the transaction, so
 * it does not stay on the pooled connection for the next request. The tenant is a bind value, never part of the SQL
 * text.
 *
 * Right after the start it runs `SET LOCAL ROLE <module>_module` (docs/adr/0029): the transaction then has the
 * privileges of that module only, its own tables for reading and writing and the tables of the modules it depends on
 * for reading. The role also ends with the transaction. The module name picks the role from a fixed list; it is never
 * part of the SQL text as a value from outside. If a step fails, it rolls back and throws that error.
 *
 * Application code uses `inTenantTransaction`; this is the primitive under it, for code outside Effect.
 */
export async function beginTenantTransaction<DB>(
  db: Kysely<DB>,
  scope: TenantScope,
): Promise<ControlledTransaction<DB>> {
  const trx = await db.startTransaction().execute();
  try {
    await sql`SET LOCAL ROLE ${sql.id(moduleRole(scope.module))}`.execute(trx);
    await sql`SELECT set_config('app.current_tenant', ${scope.tenantId}, true)`.execute(trx);
    return trx;
  } catch (error) {
    // If the rollback fails too, the error of the setup is the one to report.
    await trx
      .rollback()
      .execute()
      .catch(() => undefined);
    throw error;
  }
}

/**
 * The connection pool root. An entry point builds it once with the `ManagedRuntime` (docs/adr/0028). One pool of
 * `app_user` serves every module; the module's `Tx` says which tables and which role a transaction uses.
 */
export class Database extends Context.Service<Database, { readonly db: Kysely<never> }>()(
  "shared-kernel/Database",
) {
  static layer = (db: Kysely<never>) => Layer.succeed(Database, Database.of({ db }));
}

/**
 * The transaction tag of a module: a `Context.Service` class that carries the module's own database type and has a
 * `static readonly module`. `inTenantTransaction` takes the role from `module` and provides the transaction under this
 * tag, so code of another module (which needs its own tag) does not type-check inside it.
 */
// `Transaction<DB>` is invariant in DB, so no one `Transaction<…>` bounds the transactions of all the modules. The bound is
// what every one of them is: a provider of a query executor, which `sql` and the builders accept.
export type ModuleTx = Context.Key<unknown, QueryExecutorProvider> & {
  readonly module: ModuleName;
};

/**
 * Runs `work` in one transaction of the module `tx` with the tenant set (`beginTenantTransaction`): commits when `work`
 * succeeds and rolls back on any other exit (a typed failure, a defect, an interruption). It provides the transaction
 * to `work` under `tx` and requires `Database`. It also provides `CurrentWrite`: the moment, read once before the
 * start, with `actor`, `pgmCd` and `txId` of the scope, for `createdColumns` and `updatedColumns`. Who decides `pgmCd`
 * and `txId` (the request id, the start of a batch) is the job of the entry file. A failure to start, to commit or to
 * roll back is a defect (the error of the driver as it is).
 *
 * It does not run an effect (no `run*`, docs/adr/0028). The start of the transaction cannot be interrupted, so a
 * caller's `Effect.timeout` does not end the wait for a connection: the pool must set `connectionTimeoutMillis`
 * (docs/db/postgresql-client.md).
 */
export const inTenantTransaction = <K extends ModuleTx, A, E, R>(
  tx: K,
  scope: { readonly tenantId: string } & WriteActor,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, K["Identifier"] | CurrentWrite> | Database> =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const { db } = yield* Database;
      // Read once, here: every common column of this transaction takes this moment (`createdColumns`, …).
      const at = yield* currentInstant;
      const trx = yield* Effect.promise(() =>
        beginTenantTransaction(db, { module: tx.module, tenantId: scope.tenantId }),
      );
      return { trx, write: { at, actor: scope.actor, pgmCd: scope.pgmCd, txId: scope.txId } };
    }),
    // The only cast: the pool is untyped, and the tag of the module says which database type the transaction has.
    ({ trx, write }) =>
      work.pipe(
        Effect.provideService(tx, trx as K["Service"]),
        Effect.provideService(CurrentWrite, write),
      ),
    ({ trx }, exit) =>
      Effect.promise(async () => {
        if (!Exit.isSuccess(exit)) return trx.rollback().execute();
        try {
          await trx.commit().execute();
        } catch (error) {
          // A commit that fails (a deferred constraint, say) leaves the connection checked out: the rollback releases it.
          await trx
            .rollback()
            .execute()
            .catch(() => undefined);
          throw error;
        }
      }),
  );
