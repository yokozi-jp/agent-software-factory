import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  countIdempotencyKeys,
  createTestDatabase,
  idempotencyKeyTableSql,
  seedIdempotencyKeys,
  type TestDatabase,
} from "./index.ts";

// 掃除の試験 (Issue #325) が冪等キーの行を用意して数えるための道具。
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";
const key = "33333333-3333-4333-8333-333333333333";

describe("冪等キーの行を用意して数える道具", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    await db.migrator.query(idempotencyKeyTableSql("claim"));
  });
  afterEach(async () => {
    await db.close();
  });

  it("期限切れと期限内の行を、テナントごとに指定した件数だけ作って数えること", async () => {
    await seedIdempotencyKeys(db.superuser, {
      module: "claim",
      tenantId: tenantA,
      count: 3,
      expiry: "expired",
    });
    await seedIdempotencyKeys(db.superuser, {
      module: "claim",
      tenantId: tenantA,
      count: 2,
      expiry: "alive",
    });
    await seedIdempotencyKeys(db.superuser, {
      module: "claim",
      tenantId: tenantB,
      count: 4,
      expiry: "expired",
    });

    expect(await countIdempotencyKeys(db.superuser, "claim", tenantA)).toBe(5);
    expect(await countIdempotencyKeys(db.superuser, "claim", tenantB)).toBe(4);
    const expired = await db.superuser.query<{ n: string }>(
      "SELECT count(*) AS n FROM claim.idempotency_key WHERE expires_at <= now()",
    );
    expect(Number(expired.rows[0]?.n)).toBe(7);
  });

  it("キーと利用者を渡すと、その値の行を 1 件作ること", async () => {
    const user = "22222222-2222-4222-8222-222222222222";

    await seedIdempotencyKeys(db.superuser, {
      module: "claim",
      tenantId: tenantA,
      count: 1,
      expiry: "alive",
      key,
      userId: user,
    });

    const { rows } = await db.superuser.query<{ user_id: string; idempotency_key: string }>(
      "SELECT user_id, idempotency_key FROM claim.idempotency_key",
    );
    expect(rows).toEqual([{ user_id: user, idempotency_key: key }]);
  });

  it("スキーマ名が識別子の形でなければ、SQL を流さずに例外にすること", async () => {
    await expect(
      seedIdempotencyKeys(db.superuser, {
        module: "claim; DROP TABLE x",
        tenantId: tenantA,
        count: 1,
        expiry: "alive",
      }),
    ).rejects.toThrow(/Invalid schema name/);
    await expect(countIdempotencyKeys(db.superuser, "Claim", tenantA)).rejects.toThrow(
      /Invalid schema name/,
    );
  });
});
