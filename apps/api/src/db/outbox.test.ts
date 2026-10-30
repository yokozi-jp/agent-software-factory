import { ApprovalTx } from "@agent-software-factory/approval";
import { ClaimTx } from "@agent-software-factory/claim";
import {
  CurrentWrite,
  dbCall,
  defineEvent,
  enqueueOutbox,
  inTenantTransaction,
} from "@agent-software-factory/shared";
import { Cause, Effect, Exit } from "effect";
import { sql } from "kysely";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { useDatabase, writer } from "../../test/use-database.ts";

// Outbox の表 messaging.outbox と enqueueOutbox (Issue #269、docs/adr/0029)。モジュールのロールは INSERT だけ、
// outbox_relay は全テナントの行を読める。DB は本物の PostgreSQL で、SQS は使わない。
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";
const eventId = "11111111-1111-4111-8111-111111111111";

const claimSubmitted = defineEvent("claim.submitted", 2, {
  claimId: z.string(),
  total: z.number(),
});

const submitted = (tenantId: string, id = eventId) => ({
  id,
  tenantId,
  kind: "claim.submitted",
  version: 2,
  occurredAt: "2026-10-29T01:02:03.456Z",
  claimId: "c-1",
  total: 1200,
});

interface OutboxRow {
  tenant_id: string;
  id: string;
  event_type: string;
  event_version: number;
  serialized_event: unknown;
  traceparent: string | null;
  occurred_at: Date;
  publication_date: Date;
  completion_date: Date | null;
  status: string;
  completion_attempts: number;
  last_resubmission_date: Date | null;
  created_by: string;
  created_pgm_cd: string;
  created_tx_id: string;
  lock_no: number;
}

describe("enqueueOutbox と messaging.outbox", () => {
  const ctx = useDatabase();
  const { run, runExit } = ctx;

  const inClaim = <A, E>(tenantId: string, work: Effect.Effect<A, E, ClaimTx | CurrentWrite>) =>
    inTenantTransaction(ClaimTx, { tenantId, ...writer }, work);

  const rows = async (): Promise<OutboxRow[]> =>
    (
      await ctx.db.superuser.query<OutboxRow>(
        // テンプレートの DB には seed の行がある (docs/adr/0036)。数えるのは、このテストのテナントの行だけ。
        `SELECT * FROM messaging.outbox WHERE tenant_id = ANY($1) ORDER BY id`,
        [[tenantA, tenantB]],
      )
    ).rows;

  it("イベントを 1 行に入れ、決めた列にイベントの値と共通カラムが入ること", async () => {
    const event = submitted(tenantA);
    expect(claimSubmitted.schema.parse(event)).toEqual(event);

    await run(inClaim(tenantA, enqueueOutbox(ClaimTx, event)));

    expect(await rows()).toEqual([
      expect.objectContaining({
        tenant_id: tenantA,
        id: eventId,
        event_type: "claim.submitted",
        event_version: 2,
        serialized_event: event,
        traceparent: null,
        occurred_at: new Date("2026-10-29T01:02:03.456Z"),
        completion_date: null,
        status: "PUBLISHED",
        completion_attempts: 0,
        last_resubmission_date: null,
        created_by: writer.actor,
        created_pgm_cd: writer.pgmCd,
        created_tx_id: writer.txId,
        lock_no: 1,
      }),
    ]);
    const [row] = await rows();
    expect(row?.publication_date).toBeInstanceOf(Date);
  });

  it("どのモジュールのトランザクションからも、自分のモジュールのロールで入れられること", async () => {
    await run(inClaim(tenantA, enqueueOutbox(ClaimTx, submitted(tenantA))));
    await run(
      inTenantTransaction(
        ApprovalTx,
        { tenantId: tenantA, ...writer },
        enqueueOutbox(ApprovalTx, submitted(tenantA, "22222222-2222-4222-8222-222222222222")),
      ),
    );

    expect((await rows()).map((row) => row.id)).toEqual([
      eventId,
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("現在の span があれば traceparent に W3C の形で入れ、なければ NULL にすること", async () => {
    await run(
      inClaim(tenantA, enqueueOutbox(ClaimTx, submitted(tenantA))).pipe(Effect.withSpan("request")),
    );

    const [row] = await rows();
    expect(row?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  });

  it("別のテナントの行を入れられないこと (defect)", async () => {
    const exit = await runExit(inClaim(tenantA, enqueueOutbox(ClaimTx, submitted(tenantB))));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(JSON.stringify(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "")).toMatch(
      /row-level security/,
    );
    expect(await rows()).toEqual([]);
  });

  it("同じ id を 2 回入れると、2 回目は defect で、行は 1 つのままであること", async () => {
    await run(inClaim(tenantA, enqueueOutbox(ClaimTx, submitted(tenantA))));

    const exit = await runExit(inClaim(tenantA, enqueueOutbox(ClaimTx, submitted(tenantA))));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(await rows()).toHaveLength(1);
  });

  it("共通の項目が欠けたイベントは defect で、行を入れないこと", async () => {
    const broken = { ...submitted(tenantA), id: "not-a-uuid" };

    const exit = await runExit(inClaim(tenantA, enqueueOutbox(ClaimTx, broken)));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(await rows()).toEqual([]);
  });

  it("モジュールのロールは、Outbox の行を読めないこと (INSERT だけ)", async () => {
    await run(inClaim(tenantA, enqueueOutbox(ClaimTx, submitted(tenantA))));

    const exit = await runExit(
      inClaim(
        tenantA,
        dbCall(ClaimTx, (trx) => sql`SELECT * FROM messaging.outbox`.execute(trx)),
      ),
    );

    expect(Exit.hasDies(exit)).toBe(true);
    expect(JSON.stringify(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "")).toMatch(
      /permission denied for table outbox/,
    );
  });

  it("app_user は、補助関数の外では Outbox に入れも読みもできないこと", async () => {
    await expect(sql`SELECT * FROM messaging.outbox`.execute(ctx.kysely)).rejects.toThrow(
      /permission denied for schema messaging/,
    );
  });

  describe("送る処理のロール outbox_relay", () => {
    it("2 つのテナントの行を、どちらも読めること", async () => {
      await run(inClaim(tenantA, enqueueOutbox(ClaimTx, submitted(tenantA))));
      await run(
        inClaim(
          tenantB,
          enqueueOutbox(ClaimTx, submitted(tenantB, "33333333-3333-4333-8333-333333333333")),
        ),
      );

      const { rows: seen } = await ctx.db.outboxRelay.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM messaging.outbox WHERE tenant_id = ANY($1) ORDER BY tenant_id`,
        [[tenantA, tenantB]],
      );

      expect(seen.map((row) => row.tenant_id)).toEqual([tenantA, tenantB]);
    });

    it("送った行を UPDATE で完了にし、古い完了済みの行を DELETE で消せること", async () => {
      await run(inClaim(tenantA, enqueueOutbox(ClaimTx, submitted(tenantA))));

      const updated = await ctx.db.outboxRelay.query(
        `UPDATE messaging.outbox SET status = 'COMPLETED', completion_date = now() WHERE id = $1`,
        [eventId],
      );
      const deleted = await ctx.db.outboxRelay.query(
        `DELETE FROM messaging.outbox WHERE completion_date IS NOT NULL`,
      );

      expect(updated.rowCount).toBe(1);
      expect(deleted.rowCount).toBe(1);
      expect(await rows()).toEqual([]);
    });

    it("行を入れられず、モジュールの表も読めないこと", async () => {
      await expect(
        ctx.db.outboxRelay.query(
          `INSERT INTO messaging.outbox (tenant_id, id) VALUES ('${tenantA}', '${eventId}')`,
        ),
      ).rejects.toThrow(/permission denied for table outbox/);
      await expect(ctx.db.outboxRelay.query(`SELECT * FROM claim.t_claim`)).rejects.toThrow(
        /permission denied for schema claim/,
      );
    });
  });
});
