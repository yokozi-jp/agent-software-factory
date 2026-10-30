import type { Kysely } from "kysely";

import {
  createFaker,
  seededAt,
  seedProgram,
  type MessagingTables,
  type SeedTables,
  type SeedTenant,
  type TableSeeds,
} from "./context.ts";

// Any fixed number: the same seed gives the same rows on every run (docs/adr/0036).
const fakerSeed = 1;

/** The rows of each table of the messaging schema, for one tenant. */
const tables: TableSeeds<MessagingTables, SeedTables> = {
  // One event that is waiting to be sent. The relay (`outbox_relay`) reads the rows of every tenant (docs/adr/0029).
  "messaging.outbox": async (db, { tenantId, applicantId }) => {
    const faker = createFaker(fakerSeed);
    const id = faker.string.uuid();
    const event = {
      id,
      tenantId,
      kind: "claim.submitted",
      version: 1,
      occurredAt: seededAt.replace("Z", ".000Z"),
      claimId: faker.string.numeric(3),
    };
    await db
      .insertInto("messaging.outbox")
      .values({
        tenant_id: tenantId,
        id,
        event_type: event.kind,
        event_version: event.version,
        serialized_event: JSON.stringify(event),
        occurred_at: event.occurredAt,
        publication_date: seededAt,
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

/** Writes the rows of the `messaging` schema for `tenant`; the transaction has set the tenant already. */
export async function seedMessaging(db: Kysely<SeedTables>, tenant: SeedTenant): Promise<void> {
  for (const write of Object.values(tables)) await write(db, tenant);
}
