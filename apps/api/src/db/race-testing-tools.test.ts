import {
  awaitBlocked,
  createTestDatabase,
  diffRowCounts,
  snapshotRowCounts,
  type TestDatabase,
} from "@agent-software-factory/db/testing";
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const backendPid = async (client: PoolClient): Promise<number> => {
  const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  return Number(rows[0]?.pid);
};

// 競合と原子性のテストの道具 (docs/db/concurrency-testing.md) を、DB を使うテストを置く apps/api/src から、
// パッケージの入口 (@agent-software-factory/db/testing) で使えること。道具そのものの振る舞いは packages/db が確かめる。
describe("競合と原子性のテストの道具", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    await db.superuser.query("CREATE TABLE race_item (id int PRIMARY KEY, val text)");
    await db.superuser.query("INSERT INTO race_item VALUES (1, 'initial')");
  });

  afterEach(async () => {
    await db.close();
  });

  it("同じ行への 2 つの更新の待ちを検出し、後の更新が先の commit の後に進むこと", async () => {
    const holder = await db.superuser.connect();
    const waiter = await db.superuser.connect();
    try {
      const pids = { holder: await backendPid(holder), waiter: await backendPid(waiter) };
      await holder.query("BEGIN");
      await holder.query("UPDATE race_item SET val = 'holder' WHERE id = 1");
      const waiterUpdate = waiter.query("UPDATE race_item SET val = 'waiter' WHERE id = 1");

      await awaitBlocked(db.superuser, pids);
      await holder.query("COMMIT");

      expect((await waiterUpdate).rowCount).toBe(1);
    } finally {
      holder.release();
      waiter.release();
    }
  });

  it("失敗した処理が行を残さなければ差がなく、残せば表の名前つきで差に出ること", async () => {
    const before = await snapshotRowCounts(db.superuser);

    const client = await db.superuser.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO race_item VALUES (2, 'failed')");
      await client.query("ROLLBACK");
      expect(diffRowCounts(before, await snapshotRowCounts(db.superuser))).toEqual({});

      await client.query("INSERT INTO race_item VALUES (3, 'kept')");
    } finally {
      client.release();
    }

    expect(diffRowCounts(before, await snapshotRowCounts(db.superuser))).toEqual({
      "public.race_item": 1,
    });
  });
});
