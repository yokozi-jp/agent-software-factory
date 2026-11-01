import type { ApprovalDatabase } from "@agent-software-factory/approval";
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

type ApprovalTables = TablesOf<ApprovalDatabase>;

// Any fixed number: the same seed gives the same rows on every run (docs/adr/0036).
const fakerSeed = 1;

/** The rows of each table of the approval schema, for one tenant. */
const tables: TableSeeds<ApprovalTables, SeedTables> = {
  // One notification mail that was sent already: the row that `handleNotification` writes after it sends (docs/adr/0041).
  // The message id is the id of the event in the Outbox, a UUID like any other.
  "approval.processed_message": async (db, { tenantId, applicantId }) => {
    const faker = createFaker(fakerSeed);
    await db
      .insertInto("approval.processed_message")
      .values({
        tenant_id: tenantId,
        message_id: faker.string.uuid(),
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

/** Writes the rows of the 承認 (approval) module for `tenant`; the transaction has set the tenant already. */
export async function seedApproval(db: Kysely<SeedTables>, tenant: SeedTenant): Promise<void> {
  for (const write of Object.values(tables)) await write(db, tenant);
}
