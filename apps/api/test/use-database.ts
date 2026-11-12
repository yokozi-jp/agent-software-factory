import { createPool } from "@agent-software-factory/db/node";
import { createTestDatabase, type TestDatabase } from "@agent-software-factory/db/testing";
import { currentInstant } from "@agent-software-factory/shared-kernel/time";
import { Database, type WriteContext } from "@agent-software-factory/shared-kernel/tenant-db";
import { Effect } from "effect";
import { Kysely, PostgresDialect } from "kysely";
import { afterEach, beforeEach } from "vite-plus/test";

/**
 * `inTenantTransaction` の scope の、共通カラムに入れる値。実行者、プログラム、呼び出しの ID は固定の値で足りる。
 * `now` は、読むたびに時計の今を返す getter にする: `...writer` で展開した時点の値になり、DB の `now()` を基準に行を作るテスト
 * (期限切れの冪等キーなど) が、モジュールを読み込んだ時刻とのずれで崩れない。入口が 1 回読む形をテストで再現している (docs/adr/0043)。
 */
export const writer: WriteContext = {
  get now() {
    return Effect.runSync(currentInstant);
  },
  actor: "test-user",
  pgmCd: "db.test",
  txId: "test-tx",
};

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
