import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vite-plus/test";

import { createNodeLogger, memoryDestination, startOrFail, stdoutDestination } from "./node.ts";

describe("startOrFail (起動の失敗)", () => {
  it("実プロセスで、fatal を標準出力に 1 行出し、終了コードを非ゼロにする", () => {
    const result = spawnSync(process.execPath, ["src/__fixtures__/start-failure.ts"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    const lines = result.stdout.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      level: "FATAL",
      "event.code": "API-002",
      "exception.type": "Error",
      "exception.message": "環境変数が正しくない:\nPORT: Invalid input",
    });
  });

  it("成功すれば何も出さず、終了コードを変えない", async () => {
    const { chunks, write } = memoryDestination();
    const logger = createNodeLogger({
      destination: { write },
      level: "debug",
      service: { name: "api", version: "0", environment: "test" },
    });
    const start = vi.fn<() => void>();
    const before = process.exitCode;

    await startOrFail(logger, start);

    expect(start).toHaveBeenCalledOnce();
    expect(chunks).toEqual([]);
    expect(process.exitCode).toBe(before);
  });

  it("同じプロセスでも、失敗を fatal にして終了コードを 1 にする", async () => {
    const { lines, write } = memoryDestination();
    const logger = createNodeLogger({
      destination: { write },
      level: "info",
      service: { name: "api", version: "0", environment: "test" },
    });
    const before = process.exitCode;

    await startOrFail(logger, () => Promise.reject(new Error("pool is unreachable")));
    const after = process.exitCode;
    // テストの worker の終了コードは戻す。
    process.exitCode = before;

    expect(after).toBe(1);
    expect(lines()).toMatchObject([{ level: "FATAL", "exception.message": "pool is unreachable" }]);
  });
});

describe("出力先", () => {
  it("stdoutDestination は write を持つ", () => {
    expect(typeof stdoutDestination().write).toBe("function");
  });

  it("memoryDestination は JSON の object でない行を読まない", () => {
    const destination = memoryDestination();
    destination.write("[1]\n");
    expect(() => destination.lines()).toThrow("not a JSON object");
  });
});
