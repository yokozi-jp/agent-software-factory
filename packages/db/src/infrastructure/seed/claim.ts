import type { ClaimDatabase } from "@agent-software-factory/claim";
import type { Kysely } from "kysely";

import {
  createFaker,
  seededAt,
  seedProgram,
  type SeedTables,
  type SeedTenant,
  type TableSeeds,
  type TablesOf,
} from "./context.ts";

type ClaimTables = TablesOf<ClaimDatabase>;

// Any fixed number: the same seed gives the same rows on every run (docs/adr/0036).
const fakerSeed = 1;

/** The rows of each table of the claim schema, for one tenant. */
const tables: TableSeeds<ClaimTables, SeedTables> = {
  "claim.t_claim": async (db, { tenantId, applicantId }) => {
    const faker = createFaker(fakerSeed);
    const common = {
      tenant_id: tenantId,
      // 下書き (区分値 00、packages/claim の statusCodes)。申請者は、seed の申請者本人。
      applicant_id: applicantId,
      status_typ: "00",
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
  // One answer that POST /api/claims kept for its Idempotency-Key (docs/adr/0040): a draft that the system created. The key is a
  // UUID like any other, and the row is past `expires_at` (24 hours after `seededAt`), so the purge job can delete it.
  "claim.idempotency_key": async (db, { tenantId, applicantId }) => {
    const faker = createFaker(fakerSeed);
    await db
      .insertInto("claim.idempotency_key")
      .values({
        tenant_id: tenantId,
        user_id: applicantId,
        idempotency_key: faker.string.uuid(),
        request_hash: faker.string.hexadecimal({ length: 64, prefix: "", casing: "lower" }),
        status_code: 201,
        response_body: JSON.stringify({ id: "1", status: "draft" }),
        expires_at: "2026-01-06T09:00:00Z",
        created_at: seededAt,
        created_by: applicantId,
        created_pgm_cd: seedProgram,
        created_tx_id: seedProgram,
        updated_at: seededAt,
        updated_by: applicantId,
        updated_pgm_cd: seedProgram,
        updated_tx_id: seedProgram,
      })
      .execute();
  },
};

/** Writes the rows of the 申請 (claim) module for `tenant`; the transaction has set the tenant already. */
export async function seedClaim(db: Kysely<SeedTables>, tenant: SeedTenant): Promise<void> {
  for (const write of Object.values(tables)) await write(db, tenant);
}
