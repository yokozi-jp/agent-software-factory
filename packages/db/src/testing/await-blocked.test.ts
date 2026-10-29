import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  awaitBlocked,
  createTestDatabase,
  type BlockedSessions,
  type TestDatabase,
} from "./index.ts";

// 競合を決定的に再現する手順 (docs/db/concurrency-testing.md): A が commit せずに止め、B を別の接続で走らせ、
// awaitBlocked で B の待ちを確かめてから A を commit する。使い捨ての表 race_item で確かめる。
describe("awaitBlocked", () => {
  let db: TestDatabase;
  let holder: PoolClient;
  let waiter: PoolClient;
  // 待つ側の接続は更新で塞がるので、pid はその前に取っておく。
  let pids: BlockedSessions;

  const backendPid = async (client: PoolClient): Promise<number> => {
    const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const [row] = rows;
    if (row === undefined) throw new Error("pg_backend_pid returned no row");
    return row.pid;
  };

  beforeEach(async () => {
    db = await createTestDatabase();
    await db.superuser.query("CREATE TABLE race_item (id int PRIMARY KEY, val text, lock_no int)");
    await db.superuser.query("INSERT INTO race_item VALUES (1, 'initial', 1)");
    holder = await db.superuser.connect();
    waiter = await db.superuser.connect();
    pids = { waiter: await backendPid(waiter), holder: await backendPid(holder) };
  });

  afterEach(async () => {
    holder.release();
    waiter.release();
    await db.close();
  });

  const valueOfItem = async (): Promise<unknown> => {
    const { rows } = await db.superuser.query("SELECT val, lock_no FROM race_item WHERE id = 1");
    return rows[0];
  };

  it("待たせる側が commit するまで待つ更新を検出し、commit の後でその更新が進むこと", async () => {
    await holder.query("BEGIN");
    await holder.query("UPDATE race_item SET val = 'holder' WHERE id = 1");

    let waiterFinished = false;
    const waiterUpdate = waiter
      .query("UPDATE race_item SET val = 'waiter' WHERE id = 1")
      .finally(() => {
        waiterFinished = true;
      });
    await awaitBlocked(db.superuser, pids);

    expect(waiterFinished).toBe(false);
    await holder.query("COMMIT");
    expect((await waiterUpdate).rowCount).toBe(1);
    expect(await valueOfItem()).toEqual({ val: "waiter", lock_no: 1 });
  });

  it("一意索引の待ち (commit していない同じ値の INSERT) も検出し、commit の後で 23505 になること", async () => {
    await holder.query("BEGIN");
    await holder.query("INSERT INTO race_item VALUES (2, 'holder', 1)");

    const waiterInsert = waiter.query("INSERT INTO race_item VALUES (2, 'waiter', 1)").then(
      () => "inserted",
      (error: { code?: string }) => error.code,
    );
    await awaitBlocked(db.superuser, pids);
    await holder.query("COMMIT");

    expect(await waiterInsert).toBe("23505");
  });

  it("待つ側が何も待っていないまま上限の時間が過ぎると、2 つの pid を示して失敗すること", async () => {
    await expect(awaitBlocked(db.superuser, pids, { timeoutMs: 200 })).rejects.toThrow(
      new RegExp(`${pids.waiter}.*${pids.holder}.*待たせている接続: なし`),
    );
  });

  // 対照: 同じ手順で、lock_no の条件がない更新は両方成功して片方の更新が失われ、条件がある更新は 0 行になる。
  // 競合のテストが、本当に競合を作れていることの証明になる (docs/db/concurrency-testing.md)。
  it("別の接続が待たせているときは、失敗のメッセージにその接続を示すこと", async () => {
    const third = await db.superuser.connect();
    try {
      const thirdPid = await backendPid(third);
      await third.query("BEGIN");
      await third.query("UPDATE race_item SET val = 'third' WHERE id = 1");
      const waiterUpdate = waiter.query("UPDATE race_item SET val = 'waiter' WHERE id = 1");
      await awaitBlocked(db.superuser, { waiter: pids.waiter, holder: thirdPid });

      await expect(awaitBlocked(db.superuser, pids, { timeoutMs: 200 })).rejects.toThrow(
        new RegExp(`待たせている接続: ${thirdPid}`),
      );

      await third.query("COMMIT");
      await waiterUpdate;
    } finally {
      third.release();
    }
  });

  it("対照: lock_no の条件がない更新は、待った後に両方成功して、先の更新が失われること", async () => {
    await holder.query("BEGIN");
    await holder.query("UPDATE race_item SET val = 'holder', lock_no = lock_no + 1 WHERE id = 1");

    const waiterUpdate = waiter.query("UPDATE race_item SET val = 'waiter' WHERE id = 1");
    await awaitBlocked(db.superuser, pids);
    await holder.query("COMMIT");

    expect((await waiterUpdate).rowCount).toBe(1);
    expect(await valueOfItem()).toEqual({ val: "waiter", lock_no: 2 });
  });

  it("lock_no の条件がある更新は、待った後に 0 行になり、先の更新が残ること", async () => {
    await holder.query("BEGIN");
    await holder.query("UPDATE race_item SET val = 'holder', lock_no = lock_no + 1 WHERE id = 1");

    const waiterUpdate = waiter.query(
      "UPDATE race_item SET val = 'waiter', lock_no = lock_no + 1 WHERE id = 1 AND lock_no = 1",
    );
    await awaitBlocked(db.superuser, pids);
    await holder.query("COMMIT");

    expect((await waiterUpdate).rowCount).toBe(0);
    expect(await valueOfItem()).toEqual({ val: "holder", lock_no: 2 });
  });
});
