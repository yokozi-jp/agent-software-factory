import { describe, expect, it } from "vite-plus/test";
import {
  addFile,
  isMeasured,
  mergeFileCoverage,
  parseFileCoverage,
  parsePolicy,
  projectOf,
  scopeOf,
  summarize,
  violations,
  type FileCoverage,
  type Policy,
} from "./rules.ts";

// A file of coverage-final.json: one statement per line, `hits[n]` for line n + 1, and one branch (an `if`) per entry
// of `branches`, with the hits of its paths.
function istanbul(hits: number[], branches: number[][] = []): Record<string, unknown> {
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
    ["packages/db/src/infrastructure/migrate.ts", true],
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
    ["vendor/apps/api/src/app.ts", false],
    ["apps/api/src/app.ts.md", false],
    ["apps/api/src/app.test.tsx/index.ts", true],
  ])("%s が測定対象かどうかは %s であること", (path, expected) => {
    expect(isMeasured(path)).toBe(expected);
  });
});

describe("projectOf", () => {
  it("ファイルを持つ最も深い project を返すこと", () => {
    const all = ["packages/approval", "packages/approval/events"];
    expect(projectOf("packages/approval/events/src/index.ts", all)).toBe(
      "packages/approval/events",
    );
    expect(projectOf("packages/approval/src/index.ts", all)).toBe("packages/approval");
  });

  it("名前の先頭だけが同じ project を取らないこと", () => {
    expect(projectOf("packages/approval-extra/src/a.ts", ["packages/approval"])).toBeUndefined();
  });
});

describe("summarize", () => {
  it("行を 1 回だけ数え、そこから始まる文が実行されたら covered とすること", () => {
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

  it("分岐のすべての path を数えること", () => {
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
  it("2 つの記録が同じソースで実行したものを合計すること", () => {
    const merged = mergeFileCoverage(file([1, 0], [[1, 0]]), file([0, 3], [[0, 2]]));
    expect(summarize(merged)).toEqual({
      lines: { covered: 2, total: 2 },
      branches: { covered: 2, total: 2 },
    });
  });

  it("片方の記録だけが持つものを残すこと", () => {
    const merged = mergeFileCoverage(file([1]), file([1, 1], [[0, 1]]));
    expect(summarize(merged)).toEqual({
      lines: { covered: 2, total: 2 },
      branches: { covered: 1, total: 2 },
    });
  });

  it("分岐について 2 番目の記録の path が少ないとき、最初の記録の path を残すこと", () => {
    const merged = mergeFileCoverage(file([1], [[0, 1, 1]]), file([1], [[1, 0]]));
    expect(summarize(merged).branches).toEqual({ covered: 3, total: 3 });
  });
});

describe("addFile", () => {
  it("ファイルの最初の記録を残し、次のものを合計すること", () => {
    const coverage = new Map<string, FileCoverage>();
    addFile(coverage, "a.ts", file([1, 0]));
    expect(summarize(coverage.get("a.ts") ?? file([])).lines).toEqual({ covered: 1, total: 2 });

    addFile(coverage, "a.ts", file([0, 1]));
    expect(summarize(coverage.get("a.ts") ?? file([])).lines).toEqual({ covered: 2, total: 2 });
  });
});

describe("parseFileCoverage", () => {
  const whole = istanbul([1], [[1, 0]]);
  it.each([
    ["not an object", 1],
    ["no maps", {}],
    ["a statement without a count", { statementMap: { "0": {} }, s: {}, branchMap: {}, b: {} }],
    [
      "a branch without counts",
      { statementMap: {}, s: {}, branchMap: { "0": { type: "if", loc: {} } }, b: {} },
    ],
    ["null", null],
    ["no statementMap", { ...whole, statementMap: undefined }],
    ["no s", { ...whole, s: undefined }],
    ["no branchMap", { ...whole, branchMap: undefined }],
    ["no b", { ...whole, b: undefined }],
    ["a count that is not a number", { ...whole, s: { "0": "1" } }],
    ["a statement without a line", { ...whole, statementMap: { "0": {} } }],
    ["branch counts with one that is not a number", { ...whole, b: { "0": [1, "x"] } }],
    ["branch counts of text only", { ...whole, b: { "0": ["x"] } }],
  ])("%s を拒否すること", (_name, value) => {
    expect(parseFileCoverage(value)).toBeUndefined();
  });

  it("上の拒否が 1 つずつ壊すファイルを読むこと", () => {
    expect(parseFileCoverage(whole)).toBeDefined();
  });
});

describe("parsePolicy", () => {
  it("下限と例外を読むこと", () => {
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
    [
      "a minimum of branches that is not a number",
      { minimum: { lines: 90, branches: "90" }, exceptions: {} },
      /minimum/,
    ],
    ["no exceptions", { minimum: { lines: 90, branches: 90 } }, /exceptions/],
    [
      "a reason that is not text",
      { minimum: { lines: 90, branches: 90 }, exceptions: { "a.ts": 5 } },
      /a\.ts has no reason/,
    ],
    [
      "an exception without a reason",
      { minimum: { lines: 90, branches: 90 }, exceptions: { "a.ts": " " } },
      /a\.ts has no reason/,
    ],
  ])("%s を拒否すること", (_name, value, message) => {
    expect(parsePolicy(value)).toMatch(message);
  });
});

describe("violations", () => {
  const app = "apps/api/src/app.ts";

  it("下限ちょうどのファイルと、数えるものがないファイルを通すこと", () => {
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

  it("行と分岐で下限に達しないファイルを止めること", () => {
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

  it("すべての project のテストが実行したもので、ファイルを数えること", () => {
    const kernel = "packages/shared-kernel/src/tenant-db/db-call.ts";
    const fromApi = file([1, 1, 0, 0]);
    const fromKernel = file([0, 0, 1, 1]);
    expect(check({ [kernel]: fromApi }, [kernel])).toHaveLength(1);
    expect(check({ [kernel]: mergeFileCoverage(fromApi, fromKernel) }, [kernel])).toEqual([]);
  });

  it("どの記録にもないファイルを止め、通す方法を述べること", () => {
    expect(check({}, [app])).toEqual([
      `${app}: no test of any project ran it, and it is not an exception. Add a test, or a row to coverage-policy.json with the reason.`,
    ]);
  });

  it("記録の有無にかかわらず、例外を通すこと", () => {
    const server = "apps/api/src/server.ts";
    expect(check({}, [server])).toEqual([]);
    expect(check({ [server]: file([0]) }, [server])).toEqual([]);
  });

  it("今は下限に達するファイルの例外を止め、達しないものは残すこと", () => {
    const server = "apps/api/src/server.ts";
    expect(check({ [server]: file([1, 1]) }, [])).toEqual([
      `${server}: the file reaches the minimum now. Remove its row from coverage-policy.json.`,
    ]);
    expect(check({ [server]: file([1, 0]) }, [])).toEqual([]);
  });

  it("記録のない project のファイルと、測らないファイルを無視すること", () => {
    expect(
      check({}, ["apps/web/src/main.tsx", "apps/api/src/app.test.ts", "apps/api/src/db.gen.ts"]),
    ).toEqual([]);
  });

  it("存在しないファイル、または元から測らないファイルの例外を止めること", () => {
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

describe("scopeOf", () => {
  it("影響を受ける project の記録を読み、ほかを除き、記録の順に並べること", () => {
    expect(
      scopeOf(
        ["apps/api", "apps/web", "packages/shared-kernel"],
        ["packages/shared-kernel", "apps/api"],
      ),
    ).toEqual({ projects: ["apps/api", "packages/shared-kernel"], stale: ["apps/web"] });
  });

  it("記録のない影響を受ける project を無視すること: それは呼び出し側が言うこと", () => {
    expect(scopeOf(["apps/api"], ["apps/api", "apps/web"])).toEqual({
      projects: ["apps/api"],
      stale: [],
    });
  });

  it("影響を受ける project がないとき、何も読まないこと", () => {
    expect(scopeOf(["apps/api"], [])).toEqual({ projects: [], stale: ["apps/api"] });
  });
});
