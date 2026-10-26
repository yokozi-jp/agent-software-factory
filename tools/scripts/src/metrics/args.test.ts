import { describe, expect, it } from "vite-plus/test";
import { parseArgs, USAGE } from "./args.ts";

const at = (iso: string): number => Date.parse(iso);
const now = at("2026-10-26T03:00:00Z");

describe("parseArgs", () => {
  it("reads a period of JST days, --until included", () => {
    expect(parseArgs(["--since", "2026-10-01", "--until", "2026-10-31"], now)).toEqual({
      kind: "period",
      since: at("2026-09-30T15:00:00Z"),
      until: at("2026-10-31T15:00:00Z"),
    });
  });

  it("runs the period until now without --until", () => {
    expect(parseArgs(["--since=2026-10-01"], now)).toEqual({
      kind: "period",
      since: at("2026-09-30T15:00:00Z"),
      until: now,
    });
  });

  it("allows a period of one day", () => {
    expect(parseArgs(["--since", "2026-10-01", "--until", "2026-10-01"], now)).toEqual({
      kind: "period",
      since: at("2026-09-30T15:00:00Z"),
      until: at("2026-10-01T15:00:00Z"),
    });
  });

  it("reads a boundary pull request and a count", () => {
    expect(parseArgs(["--pr", "180", "--count", "10"], now)).toEqual({
      kind: "boundary",
      pull: 180,
      count: 10,
    });
  });

  it("rejects mixing the two forms", () => {
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
  ])("rejects a boundary without a positive whole number for both: %s %s %s %s", (...argv) => {
    expect(parseArgs(argv, now)).toBe("--pr and --count both take a positive whole number");
  });

  it("rejects no form, bad days, and a period that ends before it starts", () => {
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

  it("rejects an unknown option and a positional argument", () => {
    expect(parseArgs(["--from", "2026-10-01"], now)).toContain("Unknown option '--from'");
    expect(parseArgs(["2026-10-01"], now)).toContain("Unexpected argument '2026-10-01'");
  });

  it("has a usage line for each form", () => {
    expect(USAGE).toBe(
      "usage: node tools/scripts/src/metrics/cli.ts --since YYYY-MM-DD [--until YYYY-MM-DD]\n" +
        "       node tools/scripts/src/metrics/cli.ts --pr <number> --count <N>",
    );
  });
});
