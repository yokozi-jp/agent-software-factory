import { Database } from "@agent-software-factory/shared-kernel/tenant-db";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createApp } from "./app.ts";
import { unusedRuntime } from "./runtime.ts";

// spec の生成と DB を使わないテストが createApp に渡す runtime。DB を使うと、渡し忘れとわかる defect で落ちる。
describe("DB のない runtime (unusedRuntime)", () => {
  it("Database を使う Effect は、runtime が DB を持たないと言う defect で落ちること", async () => {
    const runtime = unusedRuntime();
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
    const res = await createApp({ runtime: unusedRuntime() }).request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
