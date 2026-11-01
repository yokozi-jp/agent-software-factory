import { createDatabase } from "@agent-software-factory/db/node";
import { Database } from "@agent-software-factory/shared-kernel/tenant-db";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createApp } from "./app.ts";
import { createApiRuntime, runtimeWithoutDatabase } from "./runtime.ts";

// api の runtime (docs/adr/0028): 入口が 1 つ作り、app.ts に渡す。route がまだ DB を使わないので、配線はここで確かめる。
// 渡した pool が app_user で SQL を流すことは、packages/db の pool.test.ts (createDatabase) が確かめる。
describe("api の runtime (createApiRuntime)", () => {
  it("Database を使う Effect に、入口が作った Kysely をそのまま渡すこと (pool は最初のクエリまで接続しない)", async () => {
    const kysely = createDatabase({ connectionString: "postgres://app_user@127.0.0.1:1/none" });
    const runtime = createApiRuntime(kysely);
    try {
      const provided = await runtime.runPromise(
        Effect.gen(function* () {
          return (yield* Database).db;
        }),
      );

      expect(provided).toBe(kysely);
    } finally {
      await runtime.dispose();
      await kysely.destroy();
    }
  });
});

// spec の生成と DB を使わないテストが createApp に渡す runtime。DB を使うと、渡し忘れとわかる defect で落ちる。
describe("DB のない runtime (runtimeWithoutDatabase)", () => {
  it("Database を使う Effect は、runtime が DB を持たないと言う defect で落ちること", async () => {
    const runtime = runtimeWithoutDatabase();
    try {
      const exit = await runtime.runPromiseExit(
        Effect.gen(function* () {
          yield* Database;
        }),
      );

      expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "succeeded").toMatch(/no database/);
    } finally {
      await runtime.dispose();
    }
  });

  it("DB を使わない route は、そのまま応答すること", async () => {
    const res = await createApp({ runtime: runtimeWithoutDatabase() }).request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
