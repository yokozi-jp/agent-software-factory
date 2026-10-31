import "@agent-software-factory/approval";
import "@agent-software-factory/claim";
import "@agent-software-factory/closing";
import { registeredConsumers } from "@agent-software-factory/shared-kernel";
import { describe, expect, it } from "vite-plus/test";

import { consumerProblems } from "../../test/consumer-check.ts";
import { useDatabase, writer } from "../../test/use-database.ts";

// 受信の処理の全件テスト (Issue #269、docs/adr/0029): defineConsumer で登録した処理の一覧を全件回し、各処理に同じ
// メッセージを 2 回渡して、2 回目が Duplicate になり、行が増えも変わりもしないことを確かめる。
// 上の import は、モジュールを読み込んで、モジュールが defineConsumer で登録する処理を一覧に載せる。
// 受信の処理を足すモジュールは、処理の名前 (defineConsumer の name) ごとの入力例を、ここの `examples` に足す。
// 入力例のない処理があると、テストが落ちる。
const examples: Readonly<Record<string, unknown>> = {};

describe("受信の処理の全件テスト", () => {
  const ctx = useDatabase();

  it("登録されたすべての処理が、同じメッセージの 2 回目を Duplicate にすること", async () => {
    const problems = await consumerProblems({
      consumers: registeredConsumers(),
      examples,
      db: ctx.db,
      write: writer,
      run: ctx.run,
    });

    expect(problems).toEqual([]);
  });
});
