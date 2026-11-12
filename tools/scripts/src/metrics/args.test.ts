import { describe, expect, it } from "vite-plus/test";
import { parseArgs, USAGE } from "./args.ts";

const at = (iso: string): number => Date.parse(iso);
const now = at("2026-10-26T03:00:00Z");

describe("parseArgs", () => {
  it("JST の日の期間を、--until を含めて読むこと", () => {
    expect(parseArgs(["--since", "2026-10-01", "--until", "2026-10-31"], now)).toEqual({
      kind: "period",
      since: at("2026-09-30T15:00:00Z"),
      until: at("2026-10-31T15:00:00Z"),
    });
  });

  it("--until がないとき、現在までの期間を実行すること", () => {
    expect(parseArgs(["--since=2026-10-01"], now)).toEqual({
      kind: "period",
      since: at("2026-09-30T15:00:00Z"),
      until: now,
    });
  });

  it("1 日の期間を許可すること", () => {
    expect(parseArgs(["--since", "2026-10-01", "--until", "2026-10-01"], now)).toEqual({
      kind: "period",
      since: at("2026-09-30T15:00:00Z"),
      until: at("2026-10-01T15:00:00Z"),
    });
  });

  it("境界の pull request と件数を読むこと", () => {
    expect(parseArgs(["--pr", "180", "--count", "10"], now)).toEqual({
      kind: "boundary",
      pull: 180,
      count: 10,
    });
  });

  it("2 つの形の混在を拒否すること", () => {
    const message = "give either --since and --until, or --pr and --count";
    expect(parseArgs(["--pr", "1", "--count", "2", "--since", "2026-10-01"], now)).toBe(message);
    expect(parseArgs(["--count", "2", "--until", "2026-10-01"], now)).toBe(message);
  });

  it.each([
    ["--pr", "180"],
    ["--count", "10"],
    ["--pr", "0", "--count", "10"],
    ["--pr", "180", "--count", "1.5"],
    ["--pr", "#180", "--count", "10"],
    ["--pr", "180", "--count", "10x"],
  ])("どちらも正の整数ではない境界を拒否すること: %s %s %s %s", (...argv) => {
    expect(parseArgs(argv, now)).toBe("--pr and --count both take a positive whole number");
  });

  it("形がないこと、不正な日数、開始より前に終わる期間を拒否すること", () => {
    expect(parseArgs([], now)).toBe("give --since, or --pr and --count");
    expect(parseArgs(["--until", "2026-10-01"], now)).toBe("give --since, or --pr and --count");
    expect(parseArgs(["--since", "2026-02-30"], now)).toBe(
      "--since is not a date (YYYY-MM-DD): 2026-02-30",
    );
    expect(parseArgs(["--since", "2026-10-01", "--until", "10/31"], now)).toBe(
      "--until is not a date (YYYY-MM-DD): 10/31",
    );
    const backwards = "--since must be a day before --until (and before now)";
    expect(parseArgs(["--since", "2026-10-02", "--until", "2026-10-01"], now)).toBe(backwards);
    expect(parseArgs(["--since", "2026-10-27"], now)).toBe(backwards);
    expect(parseArgs(["--since", "2026-10-26"], at("2026-10-25T15:00:00Z"))).toBe(backwards);
  });

  it("未知の option と位置引数を拒否すること", () => {
    expect(parseArgs(["--from", "2026-10-01"], now)).toContain("Unknown option '--from'");
    expect(parseArgs(["2026-10-01"], now)).toContain("Unexpected argument '2026-10-01'");
  });

  it("形ごとに使い方の行があること", () => {
    expect(USAGE).toBe(
      "usage: node tools/scripts/src/metrics/cli.ts --since YYYY-MM-DD [--until YYYY-MM-DD]\n" +
        "       node tools/scripts/src/metrics/cli.ts --pr <number> --count <N>",
    );
  });
});
