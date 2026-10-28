// The public API of `@agent-software-factory/db/testing` (docs/adr/0037): the tools that the tests of the db package and
// of apps/api use. It imports Vitest and testcontainers, so no production code imports it.
export {
  postgresImage,
  roles,
  templateDatabase,
  connectionUri,
  migratorUrl,
} from "./connection.ts";
export { rolePassword } from "./credentials.ts";
export { createTestDatabase, type TestDatabase } from "./database.ts";
export { reportSetupFailure } from "./global-setup.ts";
export { prepareDatabase } from "./prepare-database.ts";
