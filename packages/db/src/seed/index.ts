// The seed of the development and test databases (docs/adr/0036): the entry `seed(databaseUrl)` and `pnpm db:seed`.
//   DATABASE_URL=postgres://migrator@host/db node src/seed/index.ts
// It runs as `migrator` in one transaction and switches the tenant with `set_config`, so the policies of RLS check
// every row (docs/adr/0011). It is not idempotent: to run it again, create the database again.
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Pool } from "pg";

import { seedClaim } from "./claim.ts";
import { tenants, type SeedTables } from "./context.ts";
import { seedMessaging } from "./messaging.ts";

/**
 * Writes the rows of every module for both tenants, in the direction of the dependencies (申請 → 承認 → 締め) and then the Outbox, in one
 * transaction. Fails, and writes nothing, when tenant A already has a claim.
 */
export async function seed(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new Kysely<SeedTables>({ dialect: new PostgresDialect({ pool }) });
  try {
    await db.transaction().execute(async (trx) => {
      const [tenantA] = tenants;
      await selectTenant(trx, tenantA.tenantId);
      const existing = await trx
        .selectFrom("claim.t_claim")
        .select(sql<number>`count(*)::int`.as("count"))
        .executeTakeFirstOrThrow();
      if (existing.count > 0) {
        throw new Error(
          "the seed has run already: tenant A has claims. Create the database again to run it again (docs/adr/0036)",
        );
      }
      for (const tenant of tenants) {
        await selectTenant(trx, tenant.tenantId);
        await seedClaim(trx, tenant);
        await seedMessaging(trx, tenant);
      }
    });
  } finally {
    await db.destroy();
  }
}

/** The tenant of the rest of the transaction (`is_local` is true), as the policies of RLS read it (docs/adr/0011). */
async function selectTenant(trx: Transaction<SeedTables>, tenantId: string): Promise<void> {
  await sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`.execute(trx);
}

/* v8 ignore start -- the command line entry; the tests call seed() */
if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    process.stderr.write("環境変数 DATABASE_URL が必要\n");
    process.exit(2);
  }
  await seed(url);
}
/* v8 ignore stop */
