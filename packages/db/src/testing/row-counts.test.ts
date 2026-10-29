import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createTestDatabase,
  diffRowCounts,
  snapshotRowCounts,
  type TestDatabase,
} from "./index.ts";

// 原子性のテストの道具 (docs/db/concurrency-testing.md): 処理の前後で全表の行数を比べ、失敗した処理が
// 業務の表、Outbox、processed_message のどこにも行を残していないことを確かめる。
describe("snapshotRowCounts と diffRowCounts", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    await db.superuser.query("CREATE TABLE race_item (id int PRIMARY KEY)");
  });

  afterEach(async () => {
    await db.close();
  });

  it("rollback した行は差に出ず、commit した行は表の名前つきで差に出ること", async () => {
    const before = await snapshotRowCounts(db.superuser);

    const client = await db.superuser.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO race_item VALUES (1)");
      await client.query("ROLLBACK");
      expect(diffRowCounts(before, await snapshotRowCounts(db.superuser))).toEqual({});

      await client.query("INSERT INTO race_item VALUES (2), (3)");
    } finally {
      client.release();
    }

    expect(diffRowCounts(before, await snapshotRowCounts(db.superuser))).toEqual({
      "public.race_item": 2,
    });
  });

  it("auth と migrations のスキーマは数えず、migration が作ったモジュールの表は数えること", async () => {
    const counts = await snapshotRowCounts(db.superuser);

    const schemas = new Set(Object.keys(counts).map((name) => name.split(".")[0]));
    expect(schemas.has("auth")).toBe(false);
    expect(schemas.has("migrations")).toBe(false);
    expect(counts["claim.t_claim"]).toBe(0);
  });

  it("行を消した表は負の数で、現れた表と消えた表は 0 からの差で表すこと", () => {
    const before = { "a.t": 3, "a.gone": 1 };
    const after = { "a.t": 1, "a.new": 2 };

    expect(diffRowCounts(before, after)).toEqual({ "a.t": -2, "a.gone": -1, "a.new": 2 });
  });
});
