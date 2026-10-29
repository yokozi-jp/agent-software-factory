import { sql, type Kysely, type Transaction } from "kysely";

/** The modules of the sample feature, by their schema names (GLOSSARY.md, docs/adr/0026). */
export type ModuleName = "claim" | "approval" | "closing";

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
 * Runs `work` in one transaction with the tenant set for RLS (docs/adr/0011). The setting is
 * `set_config('app.current_tenant', …, true)`, the same as `SET LOCAL`: it ends with the transaction, so it does not
 * stay on the pooled connection for the next request. The tenant is a bind value, never part of the SQL text.
 *
 * Right after the start it runs `SET LOCAL ROLE <module>_module` (docs/adr/0029): the transaction then has the
 * privileges of that module only, its own tables for reading and writing and the tables of the modules it depends on
 * for reading. The role also ends with the transaction. The module name picks the role from a fixed list; it is never
 * part of the SQL text as a value from outside.
 */
export function inTenantTransaction<DB, T>(
  db: Kysely<DB>,
  scope: TenantScope,
  work: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE ${sql.id(moduleRole(scope.module))}`.execute(trx);
    await sql`SELECT set_config('app.current_tenant', ${scope.tenantId}, true)`.execute(trx);
    return work(trx);
  });
}
