import { createDatabase } from "@agent-software-factory/db/node";
import { createTestDatabase, type TestDatabase } from "@agent-software-factory/db/testing";
import { Database } from "@agent-software-factory/shared-kernel/tenant-db";
import { Effect } from "effect";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createApiRuntime } from "./runtime.ts";

// api の runtime (docs/adr/0028): 入口が 1 つ作り、app.ts に渡す。route がまだ DB を使わないので、配線はここで確かめる。
describe("api の runtime (createApiRuntime)", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it("Database を使う Effect を、渡した pool の app_user で動かすこと", async () => {
    const kysely = createDatabase({ connectionString: db.url("app_user"), max: 1 });
    const runtime = createApiRuntime(kysely);
    try {
      const role = await runtime.runPromise(
        Effect.gen(function* () {
          const { db: pool } = yield* Database;
          const { rows } = yield* Effect.promise(() =>
            sql<{ role: string }>`SELECT current_user AS role`.execute(pool),
          );
          return rows[0]?.role;
        }),
      );

      expect(role).toBe("app_user");
    } finally {
      await runtime.dispose();
      await kysely.destroy();
    }
  });
});
