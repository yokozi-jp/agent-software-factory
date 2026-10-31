import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { checkConventions } from "../convention-catalog.ts";
import { checkModuleRoles } from "../module-roles-catalog.ts";
import { createTestDatabase, processedMessageTableSql, type TestDatabase } from "./index.ts";

// processed_message の migration の雛形 (packages/db/templates/processed_message.sql、docs/adr/0029)。
// 雛形から作った表が、DB の規約とモジュールのロールの検査を通ることを確かめる。
describe("processed_message の雛形", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it("モジュール名を替えた SQL が、migrate:up の部分だけであること", () => {
    const sql = processedMessageTableSql("approval");

    expect(sql).toContain("CREATE TABLE approval.processed_message");
    expect(sql).not.toContain("{{module}}");
    expect(sql).not.toContain("migrate:down");
  });

  it("モジュール名に使えない文字があれば、SQL を返さずに失敗すること", () => {
    expect(() => processedMessageTableSql("claim; DROP SCHEMA claim")).toThrow(/Invalid module/);
  });

  it("3 つのモジュールに作った表が、DB の規約とモジュールのロールの検査を通ること", async () => {
    // migration が表をもう作ったモジュール (approval) には作らない。表の定義は雛形と同じ。
    for (const module of ["claim", "approval", "closing"]) {
      const { rows } = await db.superuser.query<{ found: string | null }>(
        `SELECT to_regclass('${module}.processed_message')::text AS found`,
      );
      if (rows[0]?.found === null) await db.migrator.query(processedMessageTableSql(module));
    }

    expect(await checkConventions(db.superuser)).toEqual([]);
    expect(
      await checkModuleRoles(db.superuser, {
        claim: [],
        approval: ["claim"],
        closing: ["approval", "claim"],
      }),
    ).toEqual([]);
  });
});
