import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createTestDatabase, snapshotRowCounts, type TestDatabase } from "../testing/index.ts";
import { tenants } from "./context.ts";
import { seed } from "./index.ts";

// The template database already has the seed (test/global-setup.ts), as the integration tests of apps/api see it
// (docs/adr/0036). Each test copies it.
describe("seed", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it("auth と migrations 以外のスキーマの全部の表に、1 行以上入っていること", async () => {
    // snapshotRowCounts は auth と migrations のスキーマを数えない。外してよいのはこの 2 つだけで、理由は
    // 「Better Auth の表と dbmate の履歴で、業務の seed の対象ではない」こと (docs/adr/0036)。
    const counts = await snapshotRowCounts(db.superuser);
    expect(Object.keys(counts)).toContain("claim.t_claim");

    const empty = Object.entries(counts)
      .filter(([, count]) => count === 0)
      .map(([table]) => table);

    expect(empty).toEqual([]);
  });

  it("2 回目の seed は失敗し、各表の行の数が変わらないこと", async () => {
    const before = await snapshotRowCounts(db.superuser);

    await expect(seed(db.url("migrator"))).rejects.toThrow(/has run already/);

    expect(await snapshotRowCounts(db.superuser)).toEqual(before);
  });

  it("行を消した DB には流せて、テナントごとに申請と、データパッチで直した申請が入ること", async () => {
    await db.superuser.query("TRUNCATE claim.t_claim, messaging.outbox");

    await seed(db.url("migrator"));

    const { rows } = await db.superuser.query<{ tenant_id: string; patched: boolean }>(
      "SELECT DISTINCT tenant_id, patched_id IS NOT NULL AS patched FROM claim.t_claim ORDER BY 1, 2",
    );
    expect(rows).toEqual(
      tenants.flatMap(({ tenantId }) => [
        { tenant_id: tenantId, patched: false },
        { tenant_id: tenantId, patched: true },
      ]),
    );
  });

  it("Outbox に、テナントごとに未送信のイベントが 1 行入り、outbox_relay が両方を読めること", async () => {
    const { rows } = await db.outboxRelay.query<{ tenant_id: string; status: string }>(
      "SELECT tenant_id, status FROM messaging.outbox ORDER BY tenant_id",
    );

    expect(rows).toEqual(
      tenants.map(({ tenantId }) => ({ tenant_id: tenantId, status: "PUBLISHED" })),
    );
  });

  it("テナント A を設定した migrator から、テナント B の行が見えないこと", async () => {
    const [tenantA, tenantB] = tenants;
    const client = await db.migrator.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantA.tenantId]);
      const { rows } = await client.query<{ tenant_id: string }>(
        "SELECT DISTINCT tenant_id FROM claim.t_claim",
      );
      await client.query("ROLLBACK");

      expect(rows).toEqual([{ tenant_id: tenantA.tenantId }]);
      expect(rows.map((row) => row.tenant_id)).not.toContain(tenantB.tenantId);
    } finally {
      client.release();
    }
  });
});
