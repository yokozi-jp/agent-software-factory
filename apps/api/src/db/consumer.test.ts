import { ClaimTx } from "@agent-software-factory/claim";
import { createPool } from "@agent-software-factory/db/node";
import {
  diffRowCounts,
  processedMessageTableSql,
  snapshotRowCounts,
} from "@agent-software-factory/db/testing";
import {
  dbCall,
  Database,
  createdColumns,
  CurrentWrite,
} from "@agent-software-factory/shared-kernel/tenant-db";
import {
  defineConsumer,
  enqueueOutbox,
  registeredConsumers,
} from "@agent-software-factory/shared-kernel/messaging";
import { defineEvent } from "@agent-software-factory/shared-kernel";
import { Data, Effect, Exit, Fiber } from "effect";
import { Kysely, PostgresDialect } from "kysely";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { useDatabase, writer } from "../../test/use-database.ts";

// defineConsumer と processed_message (Issue #269、docs/adr/0029): 同じメッセージを 2 回渡しても業務の処理は 1 回で、
// 失敗した処理は processed_message の行も残さない。受信の処理の全件テストは consumers.test.ts にある。
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";
const messageId = "11111111-1111-4111-8111-111111111111";

const approved = defineEvent("approval.approved", 1, { claimId: z.string() });
const message = (tenantId: string, id = messageId) => ({
  id,
  tenantId,
  kind: "approval.approved",
  version: 1,
  occurredAt: "2026-10-29T01:02:03.456Z",
  claimId: "c-1",
});

class HandlerFailed extends Data.TaggedError("HandlerFailed")<{ readonly step: string }> {}

/** 業務の処理が呼ばれた回数。テストごとに 0 に戻す。 */
let calls = 0;
beforeEach(() => {
  calls = 0;
});

/** 業務の表 (claim.t_claim) に 1 行書く。 */
const writeClaim = (tenantId: string) =>
  Effect.gen(function* () {
    const write = yield* CurrentWrite;
    yield* dbCall(ClaimTx, (trx) =>
      trx
        .insertInto("claim.t_claim")
        .values({ tenant_id: tenantId, ...createdColumns(write) })
        .execute(),
    );
  });

const countingConsumer = defineConsumer({
  tx: ClaimTx,
  name: "test/counting",
  schema: approved.schema,
  handle: (input) =>
    Effect.sync(() => {
      calls += 1;
      return `handled ${input.claimId}`;
    }),
});

/** 業務の表に 1 行書き、Outbox に 1 行入れる。業務の処理の書き込みの代わり。 */
const writeClaimAndOutbox = (tenantId: string) =>
  Effect.gen(function* () {
    calls += 1;
    yield* writeClaim(tenantId);
    yield* enqueueOutbox(ClaimTx, message(tenantId, crypto.randomUUID()));
  });

const failingConsumer = defineConsumer({
  tx: ClaimTx,
  name: "test/failing",
  schema: approved.schema,
  handle: (input) =>
    writeClaimAndOutbox(input.tenantId).pipe(
      Effect.andThen(Effect.fail(new HandlerFailed({ step: "after the writes" }))),
    ),
});

const writingConsumer = defineConsumer({
  tx: ClaimTx,
  name: "test/writing",
  schema: approved.schema,
  handle: (input) => writeClaimAndOutbox(input.tenantId),
});

describe("defineConsumer と processed_message", () => {
  const ctx = useDatabase();
  const { run, runExit } = ctx;

  beforeEach(async () => {
    // processed_message は、受け取るモジュールの migration が置く。雛形から、claim に作る。
    await ctx.db.migrator.query(processedMessageTableSql("claim"));
  });

  const processed = async () =>
    (
      await ctx.db.superuser.query<{ tenant_id: string; message_id: string; created_by: string }>(
        `SELECT tenant_id, message_id, created_by FROM claim.processed_message ORDER BY tenant_id`,
      )
    ).rows;

  it("初めてのメッセージは業務の処理を呼び、その結果を Processed で返し、processed_message に行を入れること", async () => {
    const result = await run(countingConsumer.consume(message(tenantA), writer));

    expect(result).toEqual({ _tag: "Processed", value: "handled c-1" });
    expect(calls).toBe(1);
    expect(await processed()).toEqual([
      { tenant_id: tenantA, message_id: messageId, created_by: writer.actor },
    ]);
  });

  it("同じメッセージの 2 回目は、業務の処理を呼ばずに Duplicate を返すこと", async () => {
    await run(countingConsumer.consume(message(tenantA), writer));

    const result = await run(countingConsumer.consume(message(tenantA), writer));

    expect(result).toEqual({ _tag: "Duplicate" });
    expect(calls).toBe(1);
    expect(await processed()).toHaveLength(1);
  });

  it("同じ id でもテナントが違えば、別のメッセージとして処理すること", async () => {
    await run(countingConsumer.consume(message(tenantA), writer));

    const result = await run(countingConsumer.consume(message(tenantB), writer));

    expect(result._tag).toBe("Processed");
    expect(calls).toBe(2);
    expect((await processed()).map((row) => row.tenant_id)).toEqual([tenantA, tenantB]);
  });

  it("業務の処理が失敗したら processed_message の行も残らず、次の配信でもう一度処理すること", async () => {
    const failed = await runExit(failingConsumer.consume(message(tenantA), writer));

    expect(Exit.hasFails(failed)).toBe(true);
    expect(await processed()).toEqual([]);

    const retried = await runExit(failingConsumer.consume(message(tenantA), writer));
    expect(Exit.hasFails(retried)).toBe(true);
    expect(calls).toBe(2);
  });

  it("原子性: 業務の表と Outbox に書いた後で失敗すると、業務の表、messaging.outbox、processed_message のどこにも行が残らないこと", async () => {
    const before = await snapshotRowCounts(ctx.db.superuser);

    const exit = await runExit(failingConsumer.consume(message(tenantA), writer));

    expect(Exit.hasFails(exit)).toBe(true);
    expect(calls).toBe(1);
    expect(diffRowCounts(before, await snapshotRowCounts(ctx.db.superuser))).toEqual({});
  });

  it("対照: 失敗しなければ、3 つの表に 1 行ずつ残ること (上の差がないことが、表を数えているから成り立つ)", async () => {
    const before = await snapshotRowCounts(ctx.db.superuser);

    await run(writingConsumer.consume(message(tenantA), writer));

    expect(diffRowCounts(before, await snapshotRowCounts(ctx.db.superuser))).toEqual({
      "claim.t_claim": 1,
      "claim.processed_message": 1,
      "messaging.outbox": 1,
    });
  });

  it("形の合わないメッセージは defect で、業務の処理を呼ばず、行も残さないこと", async () => {
    const exit = await runExit(
      countingConsumer.consume({ ...message(tenantA), id: "not-a-uuid" }, writer),
    );

    expect(Exit.hasDies(exit)).toBe(true);
    expect(calls).toBe(0);
    expect(await processed()).toEqual([]);
  });

  it("同時に届いた同じメッセージは、1 つが Processed、もう 1 つが Duplicate になること", async () => {
    // 接続を 2 本持つ pool。useDatabase の pool は 1 本なので、2 つの配信が順に動いてしまい、競合を確かめられない。
    const pool = createPool({ connectionString: ctx.db.url("app_user"), max: 2 });
    const kysely = new Kysely<never>({ dialect: new PostgresDialect({ pool }) });
    try {
      const slow = defineConsumer({
        tx: ClaimTx,
        name: "test/slow",
        schema: approved.schema,
        handle: () =>
          Effect.gen(function* () {
            calls += 1;
            // 先に入った配信が commit するまで、もう 1 つは同じ行で待つ。
            yield* Effect.sleep("500 millis");
          }),
      });
      const provide = <A, E>(effect: Effect.Effect<A, E, Database>) =>
        effect.pipe(Effect.provide(Database.layer(kysely)));

      const results = await Effect.runPromise(
        provide(
          Effect.gen(function* () {
            const first = yield* Effect.forkChild(slow.consume(message(tenantA), writer));
            yield* Effect.sleep("150 millis");
            const second = yield* Effect.forkChild(slow.consume(message(tenantA), writer));
            return [yield* Fiber.join(first), yield* Fiber.join(second)];
          }),
        ),
      );

      expect(results.map((result) => result._tag).toSorted()).toEqual(["Duplicate", "Processed"]);
      expect(calls).toBe(1);
      expect(await processed()).toHaveLength(1);
    } finally {
      await kysely.destroy();
    }
  });

  it("登録した処理が registeredConsumers に出て、同じ名前の登録は失敗すること", () => {
    expect(registeredConsumers().map((consumer) => consumer.name)).toEqual(
      expect.arrayContaining(["test/counting", "test/failing", "test/writing"]),
    );
    expect(countingConsumer.module).toBe("claim");

    expect(() =>
      defineConsumer({
        tx: ClaimTx,
        name: "test/counting",
        schema: approved.schema,
        handle: () => Effect.void,
      }),
    ).toThrow(/already registered: test\/counting/);
  });
});
