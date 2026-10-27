import type { ApprovalDatabase } from "@agent-software-factory/approval";
import type { ClaimDatabase } from "@agent-software-factory/claim";
import type { ClosingDatabase } from "@agent-software-factory/closing";
import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";

/** The database of each module. A module gets only its own, which sees only its schema (docs/adr/0025). */
export interface ModuleDatabases {
  readonly claim: ClaimDatabase;
  readonly approval: ApprovalDatabase;
  readonly closing: ClosingDatabase;
}

/**
 * Creates the database of each module on one pool of `app_user` (docs/adr/0011). They share the connections; only
 * the types differ. The entry file (src/server.ts) creates the pool and ends it.
 */
export function createModuleDatabases(pool: Pool): ModuleDatabases {
  const dialect = new PostgresDialect({ pool });
  return {
    claim: new Kysely({ dialect }),
    approval: new Kysely({ dialect }),
    closing: new Kysely({ dialect }),
  };
}
