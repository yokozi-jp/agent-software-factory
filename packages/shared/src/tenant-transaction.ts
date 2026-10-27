import { sql, type Kysely, type Transaction } from "kysely";

/** The modules of the sample feature, by their schema names (GLOSSARY.md, docs/adr/0026). */
export type ModuleName = "claim" | "approval" | "closing";

export interface TenantScope {
  /** The module whose tables the transaction writes: one module per transaction (docs/adr/0029). */
  readonly module: ModuleName;
  /** The tenant, from the server-side session only (docs/adr/0011). */
  readonly tenantId: string;
}

/**
 * Runs `work` in one transaction with the tenant set for RLS (docs/adr/0011). The setting is
 * `set_config('app.current_tenant', …, true)`, the same as `SET LOCAL`: it ends with the transaction, so it does not
 * stay on the pooled connection for the next request. The tenant is a bind value, never part of the SQL text.
 *
 * `scope.module` is not used yet. Issue #268 adds `SET LOCAL ROLE <module>_module` right after the start, so that
 * the transaction can touch only the tables of that module (docs/adr/0029).
 */
export function inTenantTransaction<DB, T>(
  db: Kysely<DB>,
  scope: TenantScope,
  work: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.current_tenant', ${scope.tenantId}, true)`.execute(trx);
    return work(trx);
  });
}
