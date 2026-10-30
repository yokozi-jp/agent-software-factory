import type { ClaimDatabase } from "@agent-software-factory/claim";
import type { Kysely } from "kysely";

import {
  createFaker,
  seededAt,
  seedProgram,
  type SeedTenant,
  type TableSeeds,
  type TablesOf,
} from "./context.ts";

type ClaimTables = TablesOf<ClaimDatabase>;

// Any fixed number: the same seed gives the same rows on every run (docs/adr/0036).
const fakerSeed = 1;

/** The rows of each table of the claim schema, for one tenant. */
const tables: TableSeeds<ClaimTables> = {
  "claim.t_claim": async (db, { tenantId, applicantId }) => {
    const faker = createFaker(fakerSeed);
    const common = {
      tenant_id: tenantId,
      created_at: seededAt,
      created_by: applicantId,
      created_pgm_cd: seedProgram,
      created_tx_id: seedProgram,
      updated_at: seededAt,
      updated_by: applicantId,
      updated_pgm_cd: seedProgram,
      updated_tx_id: seedProgram,
    };
    // A claim that the system wrote, and some that a data patch changed (the columns `patched_*` are filled in).
    const patchedCount = faker.number.int({ min: 1, max: 2 });
    await db
      .insertInto("claim.t_claim")
      .values([
        common,
        ...Array.from({ length: patchedCount }, () => ({
          ...common,
          patched_at: seededAt,
          patched_by: applicantId,
          patched_id: `#${faker.number.int({ min: 100, max: 999 })}`,
        })),
      ])
      .execute();
  },
};

/** Writes the rows of the 申請 (claim) module for `tenant`; the transaction has set the tenant already. */
export async function seedClaim(db: Kysely<ClaimTables>, tenant: SeedTenant): Promise<void> {
  for (const write of Object.values(tables)) await write(db, tenant);
}
