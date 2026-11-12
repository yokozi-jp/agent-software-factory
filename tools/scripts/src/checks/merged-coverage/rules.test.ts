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
  type Scope,
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

// The table as coverage-policy.json has it, except that its exceptions are the one file that most tests use.
const scope: Scope = {
  projects: ["apps/*", "packages/*", "packages/*/events"],
  notMeasured: [
    "**/*.test.{ts,tsx}",
    "**/__fixtures__/**",
    "**/*.gen.ts",
    "**/*.d.ts",
    "**/*.stories.tsx",
  ],
  entries: new Map(),
};
const policy: Policy = {
  ...scope,
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
  ])("%s → %s", (path, expected) => {
    expect(isMeasured(path, scope)).toBe(expected);
  });

  it("does not count an entry, by its path or by a glob, and counts the files next to it", () => {
    const withEntries: Scope = {
      ...scope,
      entries: new Map([
        ["apps/api/src/server.ts", "x"],
        ["apps/worker/src/local/**", "x"],
      ]),
    };
    expect(isMeasured("apps/api/src/server.ts", withEntries)).toBe(false);
    expect(isMeasured("apps/worker/src/local/setup/queues.ts", withEntries)).toBe(false);
    expect(isMeasured("apps/api/src/app.ts", withEntries)).toBe(true);
    expect(isMeasured("apps/worker/src/local.ts", withEntries)).toBe(true);
    expect(isMeasured("apps/web/src/server.ts", withEntries)).toBe(true);
  });

  it("does not count the kinds of files that the table says are not measured", () => {
    const only: Scope = { ...scope, notMeasured: ["**/*.mock.ts"] };
    expect(isMeasured("apps/api/src/db.mock.ts", only)).toBe(false);
    expect(isMeasured("apps/api/src/app.test.ts", only)).toBe(true);
  });

  it("counts the `src` of the directories of `projects`, and no others", () => {
    const apps: Scope = { ...scope, projects: ["apps/*"] };
    expect(isMeasured("apps/api/src/app.ts", apps)).toBe(true);
    expect(isMeasured("packages/db/src/a.ts", apps)).toBe(false);
    const two: Scope = { ...scope, projects: ["apps/*", "libs/*"] };
    expect(isMeasured("libs/a/src/a.ts", two)).toBe(true);
    expect(isMeasured("apps/api/src/app.ts", two)).toBe(true);
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

describe("addFile", () => {
  it("keeps the first record of a file, and adds up the next ones", () => {
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
  ])("refuses %s", (_name, value) => {
    expect(parseFileCoverage(value)).toBeUndefined();
  });

  it("reads the file that the refusals above break one part of", () => {
    expect(parseFileCoverage(whole)).toBeDefined();
  });
});

describe("parsePolicy", () => {
  const table = {
    minimum: { lines: 90, branches: 90 },
    projects: ["apps/*"],
    notMeasured: ["**/*.test.ts"],
    entries: { "a/server.ts": "starts it" },
    exceptions: { "a.ts": "why" },
  };

  it("reads the minimum, the scope and the exceptions", () => {
    expect(parsePolicy({ ...table, minimum: { lines: 90, branches: 80 } })).toEqual({
      minimum: { lines: 90, branches: 80 },
      projects: ["apps/*"],
      notMeasured: ["**/*.test.ts"],
      entries: new Map([["a/server.ts", "starts it"]]),
      exceptions: new Map([["a.ts", "why"]]),
    });
  });

  it.each([
    ["not an object", [], /not an object/],
    ["no minimum", { ...table, minimum: undefined }, /minimum/],
    [
      "a minimum that is not a number",
      { ...table, minimum: { lines: "90", branches: 90 } },
      /minimum/,
    ],
    [
      "a minimum of branches that is not a number",
      { ...table, minimum: { lines: 90, branches: "90" } },
      /minimum/,
    ],
    ["no projects", { ...table, projects: undefined }, /projects needs a list of globs/],
    ["no project", { ...table, projects: [] }, /projects needs a list of globs/],
    ["a project that is not text", { ...table, projects: [5] }, /projects needs a list of globs/],
    ["a project that is empty", { ...table, projects: [" "] }, /projects needs a list of globs/],
    ["no notMeasured", { ...table, notMeasured: undefined }, /notMeasured needs a list of globs/],
    ["a notMeasured that is not text", { ...table, notMeasured: [5] }, /notMeasured needs a list/],
    ["no entries", { ...table, entries: undefined }, /entries is not an object/],
    [
      "an entry without a reason",
      { ...table, entries: { "a.ts": " " } },
      /the entry for a\.ts has no reason/,
    ],
    ["no exceptions", { ...table, exceptions: undefined }, /exceptions is not an object/],
    [
      "a reason that is not text",
      { ...table, exceptions: { "a.ts": 5 } },
      /the exception for a\.ts has no reason/,
    ],
    [
      "an exception without a reason",
      { ...table, exceptions: { "a.ts": " " } },
      /the exception for a\.ts has no reason/,
    ],
  ])("refuses %s", (_name, value, message) => {
    expect(parsePolicy(value)).toMatch(message);
  });

  it("accepts a table with nothing that is not measured", () => {
    expect(parsePolicy({ ...table, notMeasured: [], entries: {} })).toMatchObject({
      notMeasured: [],
      entries: new Map(),
    });
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

  it("stops an exception for a file that reaches the minimum now, and keeps one that does not", () => {
    const server = "apps/api/src/server.ts";
    expect(check({ [server]: file([1, 1]) }, [])).toEqual([
      `${server}: the file reaches the minimum now. Remove its row from coverage-policy.json.`,
    ]);
    expect(check({ [server]: file([1, 0]) }, [])).toEqual([]);
  });

  it("ignores the files of a project without a record, and the files that are not measured", () => {
    expect(
      check({}, ["apps/web/src/main.tsx", "apps/api/src/app.test.ts", "apps/api/src/db.gen.ts"]),
    ).toEqual([]);
  });

  it("stops an exception for a file that does not exist, or that is not measured anyway", () => {
    const stale: Policy = {
      ...policy,
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

describe("violations of the entries", () => {
  const entries = new Map([
    ["apps/api/src/server.ts", "starts it"],
    ["apps/worker/src/local/**", "run by hand"],
  ]);
  const withEntries: Policy = { ...policy, exceptions: new Map(), entries };
  const run = (tracked: string[], overrides: Partial<Policy> = {}, projects = ["apps/api"]) =>
    violations({
      policy: { ...withEntries, ...overrides },
      projects,
      tracked,
      coverage: new Map(),
    });

  it("does not ask for a record of an entry, whether it is a path or a glob", () => {
    expect(
      run(["apps/api/src/server.ts", "apps/worker/src/local/send.ts"], {}, [
        "apps/api",
        "apps/worker",
      ]),
    ).toEqual([]);
  });

  it("stops a row that no file of a project's `src` matches", () => {
    expect(run(["apps/api/src/server.ts"])).toEqual([
      "apps/worker/src/local/**: the entry matches no file. Remove its row.",
    ]);
  });

  it("does not take a file outside the `src` of the projects for the file of an entry", () => {
    expect(run(["apps/api/src/server.ts", "docs/apps/worker/src/local/a.ts"])).toEqual([
      "apps/worker/src/local/**: the entry matches no file. Remove its row.",
    ]);
  });

  it("stops an exception for a file that is an entry, because it is not measured", () => {
    const failures = run(["apps/api/src/server.ts", "apps/worker/src/local/a.ts"], {
      exceptions: new Map([["apps/api/src/server.ts", "x"]]),
    });
    expect(failures).toEqual([
      "apps/api/src/server.ts: the exception names a file that is not measured anyway. Remove its row.",
    ]);
  });
});

describe("scopeOf", () => {
  it("reads the records of the affected projects and leaves out the others, in the order of the records", () => {
    expect(
      scopeOf(
        ["apps/api", "apps/web", "packages/shared-kernel"],
        ["packages/shared-kernel", "apps/api"],
      ),
    ).toEqual({ projects: ["apps/api", "packages/shared-kernel"], stale: ["apps/web"] });
  });

  it("ignores an affected project that has no record: that is for the caller to say", () => {
    expect(scopeOf(["apps/api"], ["apps/api", "apps/web"])).toEqual({
      projects: ["apps/api"],
      stale: [],
    });
  });

  it("reads nothing when no project is affected", () => {
    expect(scopeOf(["apps/api"], [])).toEqual({ projects: [], stale: ["apps/api"] });
  });
});
