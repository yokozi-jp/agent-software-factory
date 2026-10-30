import { ClaimTx } from "@agent-software-factory/claim";
import {
  defineConsumer,
  defineEvent,
  type RegisteredConsumer,
} from "@agent-software-factory/shared-kernel";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { consumerProblems } from "../../test/consumer-check.ts";
import { useDatabase, writer } from "../../test/use-database.ts";

// 受信の処理の全件テスト (consumers.test.ts) の検査 consumerProblems が、規則を破った処理を見つけること (#30)。
// ここで登録する処理は、全件テストの一覧に載せないよう、別のファイルに置く。
describe("consumerProblems の検出力", () => {
  const ctx = useDatabase();

  const sent = defineEvent("test.sent", 1, {});
  const example = {
    id: "22222222-2222-4222-8222-222222222222",
    tenantId: "00000000-0000-4000-8000-00000000000a",
    kind: "test.sent",
    version: 1,
    occurredAt: "2026-10-29T01:02:03.456Z",
  };
  const registered = defineConsumer({
    tx: ClaimTx,
    name: "check/registered",
    schema: sent.schema,
    handle: () => Effect.void,
  });

  it("入力例のない処理を見つけること", async () => {
    const problems = await consumerProblems({
      consumers: [registered],
      examples: {},
      db: ctx.db,
      write: writer,
      run: ctx.run,
    });

    expect(problems).toEqual([
      "check/registered: no example message (add one to the examples of the test)",
    ]);
  });

  it("処理のない入力例を見つけること", async () => {
    const problems = await consumerProblems({
      consumers: [],
      examples: { "check/gone": example },
      db: ctx.db,
      write: writer,
      run: ctx.run,
    });

    expect(problems).toEqual(["check/gone: the example has no registered consumer"]);
  });

  it("1 回目を Processed にしない処理を見つけること", async () => {
    const never: RegisteredConsumer = {
      name: "check/never",
      module: "claim",
      consume: () => Effect.succeed({ _tag: "Duplicate" } as const),
    };

    const problems = await consumerProblems({
      consumers: [never],
      examples: { "check/never": example },
      db: ctx.db,
      write: writer,
      run: ctx.run,
    });

    expect(problems).toEqual(["check/never: the first delivery is Duplicate, not Processed"]);
  });

  it("2 回目も Processed にしてしまう処理 (重複を除かない処理) を見つけること", async () => {
    let delivery = 0;
    const leaky: RegisteredConsumer = {
      name: "check/leaky",
      module: "claim",
      consume: () => Effect.sync(() => ({ _tag: "Processed", value: (delivery += 1) }) as const),
    };

    const problems = await consumerProblems({
      consumers: [leaky],
      examples: { "check/leaky": example },
      db: ctx.db,
      write: writer,
      run: ctx.run,
    });

    expect(problems).toEqual(["check/leaky: the second delivery is Processed, not Duplicate"]);
  });

  it("2 回目に行を増やす処理を見つけること", async () => {
    let delivery = 0;
    const writes: RegisteredConsumer = {
      name: "check/writes",
      module: "claim",
      consume: () =>
        Effect.promise(async () => {
          delivery += 1;
          if (delivery === 2)
            await ctx.db.superuser.query(`INSERT INTO claim.processed_message
                (tenant_id, message_id, created_at, created_by, created_pgm_cd, created_tx_id,
                 updated_at, updated_by, updated_pgm_cd, updated_tx_id)
                VALUES ('${example.tenantId}', '${example.id}', now(), 'x', 'x', 'x', now(), 'x', 'x', 'x')`);
          return delivery === 1
            ? ({ _tag: "Processed", value: 1 } as const)
            : ({ _tag: "Duplicate" } as const);
        }),
    };

    const problems = await consumerProblems({
      consumers: [writes],
      examples: { "check/writes": example },
      db: ctx.db,
      write: writer,
      run: ctx.run,
    });

    expect(problems).toEqual([
      'check/writes: the second delivery changed rows: {"claim.processed_message":1}',
    ]);
  });
});
