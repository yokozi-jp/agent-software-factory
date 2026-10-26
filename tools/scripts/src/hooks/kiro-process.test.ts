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
  it("is true for a live process whose command line names kiro", () => {
    expect(isLiveKiro(kiro.pid)).toBe(true);
  });

  it("is false for a live process that is not kiro", () => {
    expect(isLiveKiro(other.pid)).toBe(false);
  });

  it.each([2 ** 22 + 1, Number.NaN, 0])(
    "is false for %d, which is not a running process",
    (pid) => {
      expect(isLiveKiro(pid)).toBe(false);
    },
  );

  it("reads the command line from /proc", () => {
    // A /proc whose record of the sleep process names kiro: ps would say it is not kiro.
    const proc = join(box.root, "proc");
    mkdirSync(join(proc, String(other.pid)), { recursive: true });
    writeFileSync(join(proc, String(other.pid), "cmdline"), "kiro-cli\0chat\0");
    expect(isLiveKiro(other.pid, proc)).toBe(true);
  });

  it("asks ps where there is no /proc", () => {
    expect(isLiveKiro(kiro.pid, join(box.root, "no-proc"))).toBe(true);
    expect(isLiveKiro(other.pid, join(box.root, "no-proc"))).toBe(false);
  });
});
