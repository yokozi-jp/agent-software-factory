import { createPool } from "@agent-software-factory/db/node";
import { createTestDatabase, type TestDatabase } from "@agent-software-factory/db/testing";
import { Database, type WriteActor } from "@agent-software-factory/shared-kernel/tenant-db";
import { Effect } from "effect";
import { Kysely, PostgresDialect } from "kysely";
import { afterEach, beforeEach } from "vite-plus/test";

/** `inTenantTransaction` の scope の、共通カラムに入れる値。テストでは、どれも固定の値で足りる。 */
export const writer: WriteActor = { actor: "test-user", pgmCd: "db.test", txId: "test-tx" };

/** テストごとに DB を作り、接続を 1 本の pool にして、前のトランザクションの設定が同じ接続に残るかを確かめられるようにする。 */
export function useDatabase() {
  let current: { db: TestDatabase; kysely: Kysely<never> } | undefined;
  const opened = () => {
    if (current === undefined) throw new Error("The database is not open: use it inside a test.");
    return current;
  };

  beforeEach(async () => {
    const db = await createTestDatabase();
    const pool = createPool({ connectionString: db.url("app_user"), max: 1 });
    current = { db, kysely: new Kysely({ dialect: new PostgresDialect({ pool }) }) };
  });

  afterEach(async () => {
    await current?.kysely.destroy();
    await current?.db.close();
    current = undefined;
  });

  return {
    get db() {
      return opened().db;
    },
    get kysely() {
      return opened().kysely;
    },
    run: <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromise(effect.pipe(Effect.provide(Database.layer(opened().kysely)))),
    runExit: <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromiseExit(effect.pipe(Effect.provide(Database.layer(opened().kysely)))),
  };
}
