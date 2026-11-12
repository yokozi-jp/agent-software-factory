// The public API of `@agent-software-factory/db/testing` (docs/adr/0038): the tools that the tests of the db package and
// of apps/api use. It imports Vitest and testcontainers, so no production code imports it.
export {
  postgresImage,
  roles,
  templateDatabase,
  connectionUri,
  migratorUrl,
} from "./testing/connection.ts";
export {
  awaitBlocked,
  type AwaitBlockedOptions,
  type BlockedSessions,
} from "./testing/await-blocked.ts";
export { rolePassword } from "./testing/credentials.ts";
export { createTestDatabase, type TestDatabase } from "./testing/database.ts";
export { reportSetupFailure } from "./testing/global-setup.ts";
export { prepareDatabase, prepareSeededDatabase } from "./testing/prepare-database.ts";
export {
  rolledBackPerTest,
  type MigratorQuery,
  type RolledBackQueries,
  type RolledBackSession,
} from "./testing/rolled-back.ts";
export { startPostgres } from "./testing/postgres-container.ts";
export { ensureIdempotencyKeyTable, idempotencyKeyTableSql } from "./testing/idempotency-key.ts";
export {
  countIdempotencyKeys,
  seedIdempotencyKeys,
  type ExpiryExpression,
} from "./testing/idempotency-key-rows.ts";
export { processedMessageTableSql } from "./testing/processed-message.ts";
export {
  diffRowCounts,
  snapshotRowCounts,
  type RowCountDiff,
  type RowCounts,
} from "./testing/row-counts.ts";
