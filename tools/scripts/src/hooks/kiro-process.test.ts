import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { sandbox, startIn, type Background, type Sandbox } from "../test/sandbox.ts";
import { isLiveKiro } from "./kiro-process.ts";

let box: Sandbox;
let kiro: Background;
let other: Background;
beforeAll(() => {
  box = sandbox();
  // A live process whose command line contains "kiro", and one whose does not.
  kiro = startIn(box.root, process.execPath, ["-e", "setInterval(() => {}, 1000)", "kiro-fake"]);
  other = startIn(box.root, "sleep", ["60"]);
});
afterAll(async () => {
  await kiro.stop();
  await other.stop();
  box.remove();
});

describe("isLiveKiro", () => {
  it("コマンドラインに kiro を含む生きたプロセスで true になること", () => {
    expect(isLiveKiro(kiro.pid)).toBe(true);
  });

  it("kiro ではない生きたプロセスで false になること", () => {
    expect(isLiveKiro(other.pid)).toBe(false);
  });

  it.each([2 ** 22 + 1, Number.NaN, 0])(
    "実行中のプロセスではない %d で false になること",
    (pid) => {
      expect(isLiveKiro(pid)).toBe(false);
    },
  );

  it("/proc からコマンドラインを読むこと", () => {
    // A /proc whose record of the sleep process names kiro: ps would say it is not kiro.
    const proc = join(box.root, "proc");
    mkdirSync(join(proc, String(other.pid)), { recursive: true });
    writeFileSync(join(proc, String(other.pid), "cmdline"), "kiro-cli\0chat\0");
    expect(isLiveKiro(other.pid, proc)).toBe(true);
  });

  it("/proc がないところでは ps に尋ねること", () => {
    expect(isLiveKiro(kiro.pid, join(box.root, "no-proc"))).toBe(true);
    expect(isLiveKiro(other.pid, join(box.root, "no-proc"))).toBe(false);
  });
});
