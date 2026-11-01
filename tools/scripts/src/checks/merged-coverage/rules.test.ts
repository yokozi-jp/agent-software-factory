import { describe, expect, it } from "vite-plus/test";
import {
  isMeasured,
  mergeFileCoverage,
  parseFileCoverage,
  parsePolicy,
  projectOf,
  summarize,
  violations,
  type FileCoverage,
  type Policy,
} from "./rules.ts";

// A file of coverage-final.json: one statement per line, `hits[n]` for line n + 1, and one branch (an `if`) per entry
// of `branches`, with the hits of its paths.
function istanbul(hits: number[], branches: number[][] = []): unknown {
  const at = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 10 } });
  return {
    path: "ignored",
    statementMap: Object.fromEntries(hits.map((_, index) => [String(index), at(index + 1)])),
    s: Object.fromEntries(hits.map((count, index) => [String(index), count])),
    branchMap: Object.fromEntries(
      branches.map((paths, index) => [
        String(index),
        { type: "if", loc: at(index + 1), locations: paths.map(() => at(index + 1)) },
      ]),
    ),
    b: Object.fromEntries(branches.map((paths, index) => [String(index), paths])),
  };
}
function file(hits: number[], branches: number[][] = []): FileCoverage {
  const parsed = parseFileCoverage(istanbul(hits, branches));
  if (parsed === undefined) throw new Error("fixture is not in Istanbul's format");
  return parsed;
}

const policy: Policy = {
  minimum: { lines: 90, branches: 90 },
  exceptions: new Map([["apps/api/src/server.ts", "entry"]]),
};
const projects = ["apps/api", "packages/shared-kernel"];
const check = (
  coverage: Record<string, FileCoverage>,
  tracked: string[],
  overrides: Partial<{ policy: Policy; projects: string[] }> = {},
) =>
  violations({
    policy: overrides.policy ?? policy,
    projects: overrides.projects ?? projects,
    // The entry that the default policy excepts is in every checkout.
    tracked: [...tracked, ...(overrides.policy ? [] : ["apps/api/src/server.ts"])],
    coverage: new Map(Object.entries(coverage)),
  });

describe("isMeasured", () => {
  it.each([
    ["apps/api/src/app.ts", true],
    ["apps/web/src/screens/home.tsx", true],
    ["packages/db/src/migrate.ts", true],
    ["packages/approval/events/src/index.ts", true],
    ["apps/api/src/app.test.ts", false],
    ["apps/web/src/screens/home.test.tsx", false],
    ["apps/api/src/__fixtures__/typed-rules.ts", false],
    ["packages/approval/src/infrastructure/__fixtures__/database.ts", false],
    ["packages/approval/src/infrastructure/db.gen.ts", false],
    ["packages/ui/src/components/button.stories.tsx", false],
    ["packages/ui/src/styles/globals.css", false],
    ["apps/api/test/use-database.ts", false],
    ["tools/scripts/src/checks/git.ts", false],
    ["packages/ui/src/vite-env.d.ts", false],
  ])("%s → %s", (path, expected) => {
    expect(isMeasured(path)).toBe(expected);
  });
});

describe("projectOf", () => {
  it("returns the deepest project that holds the file", () => {
    const all = ["packages/approval", "packages/approval/events"];
    expect(projectOf("packages/approval/events/src/index.ts", all)).toBe(
      "packages/approval/events",
    );
    expect(projectOf("packages/approval/src/index.ts", all)).toBe("packages/approval");
  });

  it("does not take a project whose name only starts the same", () => {
    expect(projectOf("packages/approval-extra/src/a.ts", ["packages/approval"])).toBeUndefined();
  });
});

describe("summarize", () => {
  it("counts a line once, covered when a statement that starts on it ran", () => {
    const twoOnOneLine = parseFileCoverage({
      statementMap: {
        "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 3 } },
        "1": { start: { line: 1, column: 5 }, end: { line: 1, column: 9 } },
      },
      s: { "0": 0, "1": 4 },
      branchMap: {},
      b: {},
    });
    expect(twoOnOneLine && summarize(twoOnOneLine)).toEqual({
      lines: { covered: 1, total: 1 },
      branches: { covered: 0, total: 0 },
    });
  });

  it("counts every path of a branch", () => {
    expect(
      summarize(
        file(
          [1],
          [
            [1, 0],
            [0, 0, 2],
          ],
        ),
      ),
    ).toEqual({
      lines: { covered: 1, total: 1 },
      branches: { covered: 2, total: 5 },
    });
  });
});

describe("mergeFileCoverage", () => {
  it("adds up what the two records ran of the same source", () => {
    const merged = mergeFileCoverage(file([1, 0], [[1, 0]]), file([0, 3], [[0, 2]]));
    expect(summarize(merged)).toEqual({
      lines: { covered: 2, total: 2 },
      branches: { covered: 2, total: 2 },
    });
  });

  it("keeps what only one record has", () => {
    const merged = mergeFileCoverage(file([1]), file([1, 1], [[0, 1]]));
    expect(summarize(merged)).toEqual({
      lines: { covered: 2, total: 2 },
      branches: { covered: 1, total: 2 },
    });
  });

  it("keeps the paths of the first record when the second has fewer for a branch", () => {
    const merged = mergeFileCoverage(file([1], [[0, 1, 1]]), file([1], [[1, 0]]));
    expect(summarize(merged).branches).toEqual({ covered: 3, total: 3 });
  });
});

describe("parseFileCoverage", () => {
  it.each([
    ["not an object", 1],
    ["no maps", {}],
    ["a statement without a count", { statementMap: { "0": {} }, s: {}, branchMap: {}, b: {} }],
    [
      "a branch without counts",
      { statementMap: {}, s: {}, branchMap: { "0": { type: "if", loc: {} } }, b: {} },
    ],
  ])("refuses %s", (_name, value) => {
    expect(parseFileCoverage(value)).toBeUndefined();
  });
});

describe("parsePolicy", () => {
  it("reads the minimum and the exceptions", () => {
    expect(
      parsePolicy({ minimum: { lines: 90, branches: 80 }, exceptions: { "a.ts": "why" } }),
    ).toEqual({ minimum: { lines: 90, branches: 80 }, exceptions: new Map([["a.ts", "why"]]) });
  });

  it.each([
    ["not an object", [], /not an object/],
    ["no minimum", { exceptions: {} }, /minimum/],
    [
      "a minimum that is not a number",
      { minimum: { lines: "90", branches: 90 }, exceptions: {} },
      /minimum/,
    ],
    ["no exceptions", { minimum: { lines: 90, branches: 90 } }, /exceptions/],
    [
      "an exception without a reason",
      { minimum: { lines: 90, branches: 90 }, exceptions: { "a.ts": " " } },
      /a\.ts has no reason/,
    ],
  ])("refuses %s", (_name, value, message) => {
    expect(parsePolicy(value)).toMatch(message);
  });
});

describe("violations", () => {
  const app = "apps/api/src/app.ts";

  it("passes a file at the minimum, and a file with nothing to count", () => {
    expect(
      check(
        {
          [app]: file([1, 1, 1, 1, 1, 1, 1, 1, 1, 0], [[1, 1, 1, 1, 1, 1, 1, 1, 1, 0]]),
          "apps/api/src/types.ts": file([]),
        },
        [app, "apps/api/src/types.ts"],
      ),
    ).toEqual([]);
  });

  it("stops a file under the minimum for lines, and one for branches", () => {
    const failures = check(
      {
        [app]: file([1, 1, 1, 0]),
        "apps/api/src/b.ts": file([1], [[1, 0]]),
      },
      [app, "apps/api/src/b.ts"],
    );
    expect(failures).toEqual([
      "apps/api/src/app.ts: lines 75% (minimum 90%), branches 100% (minimum 90%).",
      "apps/api/src/b.ts: lines 100% (minimum 90%), branches 50% (minimum 90%).",
    ]);
  });

  it("counts a file by what the tests of every project ran", () => {
    const kernel = "packages/shared-kernel/src/tenant-db/db-call.ts";
    const fromApi = file([1, 1, 0, 0]);
    const fromKernel = file([0, 0, 1, 1]);
    expect(check({ [kernel]: fromApi }, [kernel])).toHaveLength(1);
    expect(check({ [kernel]: mergeFileCoverage(fromApi, fromKernel) }, [kernel])).toEqual([]);
  });

  it("stops a file that no record has, and says how to let it pass", () => {
    expect(check({}, [app])).toEqual([
      `${app}: no test of any project ran it, and it is not an exception. Add a test, or a row to coverage-policy.json with the reason.`,
    ]);
  });

  it("lets an exception pass, with or without a record", () => {
    const server = "apps/api/src/server.ts";
    expect(check({}, [server])).toEqual([]);
    expect(check({ [server]: file([0]) }, [server])).toEqual([]);
  });

  it("ignores the files of a project without a record, and the files that are not measured", () => {
    expect(
      check({}, ["apps/web/src/main.tsx", "apps/api/src/app.test.ts", "apps/api/src/db.gen.ts"]),
    ).toEqual([]);
  });

  it("stops an exception for a file that does not exist, or that is not measured anyway", () => {
    const stale: Policy = {
      minimum: policy.minimum,
      exceptions: new Map([
        ["apps/api/src/gone.ts", "x"],
        ["apps/api/src/app.test.ts", "x"],
      ]),
    };
    expect(check({}, ["apps/api/src/app.test.ts"], { policy: stale })).toEqual([
      "apps/api/src/gone.ts: the exception names a file that does not exist. Remove its row.",
      "apps/api/src/app.test.ts: the exception names a file that is not measured anyway. Remove its row.",
    ]);
  });
});
