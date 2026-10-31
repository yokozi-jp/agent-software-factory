import { describe, expect, it } from "vite-plus/test";
import { checkRun, file, pull, ruleset, run } from "./fixtures/github.ts";
import {
  around,
  categoryOf,
  counted,
  feedbackLoop,
  fixes,
  inPeriod,
  isSampleFile,
  items,
  pushes,
  quantile,
  requiredChecks,
  reworked,
  summarize,
  toPull,
  type Merged,
  type Pull,
  type Sample,
} from "./metrics.ts";

const at = (iso: string): number => Date.parse(iso);

// A pull request as toPull reads it from the API fixture.
const read = (...args: Parameters<typeof pull>): Pull => {
  const parsed = toPull(pull(...args));
  if (parsed === undefined) throw new Error("fixture is not a pull request");
  return parsed;
};

const merged = (...args: Parameters<typeof pull>): Merged => {
  const parsed = read(...args);
  if (parsed.mergedAt === undefined) throw new Error("fixture is not merged");
  return { ...parsed, mergedAt: parsed.mergedAt };
};

describe("items", () => {
  it("joins the pages of arrays that --slurp prints", () => {
    expect(items([[1, 2], [3]])).toEqual([1, 2, 3]);
  });

  it("joins the arrays that each page holds under the key", () => {
    const pages = [
      { total_count: 3, workflow_runs: [1, 2] },
      { total_count: 3, workflow_runs: [3] },
    ];
    expect(items(pages, "workflow_runs")).toEqual([1, 2, 3]);
  });

  it("skips what is not a page of items", () => {
    expect(items({ workflow_runs: [1] }, "workflow_runs")).toEqual([]);
    expect(items([{ other: [1] }, "page", [2]], "workflow_runs")).toEqual([]);
    expect(items([{ x: 1 }, [2]])).toEqual([2]);
  });
});

describe("requiredChecks", () => {
  it("reads the required status checks and their apps from the ruleset", () => {
    const checks = [
      { context: "main", integration_id: 15368 },
      { context: "commitlint" },
      { context: "betterleaks", integration_id: "15368" },
    ];
    expect(requiredChecks(ruleset(checks))).toEqual([
      { context: "main", app: 15368 },
      { context: "commitlint", app: undefined },
      { context: "betterleaks", app: undefined },
    ]);
  });

  it("finds none in a ruleset without the rule, or in what is not a ruleset", () => {
    expect(requiredChecks({ rules: [{ type: "deletion" }] })).toEqual([]);
    expect(requiredChecks({ rules: [{ type: "required_status_checks" }] })).toEqual([]);
    expect(requiredChecks([])).toEqual([]);
    expect(requiredChecks(null)).toEqual([]);
  });

  it("skips a check without a name", () => {
    const checks = [{ context: 7 }, { context: "main" }];
    const rules = [
      { type: "required_status_checks", parameters: { required_status_checks: checks } },
    ];
    expect(requiredChecks({ rules })).toEqual([{ context: "main", app: undefined }]);
  });
});

describe("toPull", () => {
  it("reads the fields of a pull request", () => {
    const raw = pull(12, {
      title: "feat(api): add",
      body: "直す PR: #3",
      labels: ["rework", "bug"],
      branch: "feat/add",
      createdAt: "2026-10-01T01:00:00Z",
      mergedAt: "2026-10-02T02:00:00Z",
    });
    expect(toPull(raw)).toEqual({
      number: 12,
      title: "feat(api): add",
      body: "直す PR: #3",
      bot: false,
      labels: ["rework", "bug"],
      branch: "feat/add",
      createdAt: at("2026-10-01T01:00:00Z"),
      mergedAt: at("2026-10-02T02:00:00Z"),
    });
  });

  it("marks a pull request of a bot, and reads one closed without a merge", () => {
    const parsed = toPull(pull(5, { login: "renovate[bot]", mergedAt: null }));
    expect(parsed?.bot).toBe(true);
    expect(parsed?.mergedAt).toBeUndefined();
  });

  it("reads a missing body, title, user, labels and branch as empty", () => {
    const raw = { number: 1, created_at: "2026-10-01T00:00:00Z", body: null, labels: [{ id: 1 }] };
    const parsed = toPull(raw);
    expect(parsed).toEqual({
      number: 1,
      title: "",
      body: "",
      bot: false,
      labels: [],
      branch: "",
      createdAt: at("2026-10-01T00:00:00Z"),
      mergedAt: undefined,
    });
  });

  it("rejects what has no number or creation time", () => {
    expect(toPull({ created_at: "2026-10-01T00:00:00Z" })).toBeUndefined();
    expect(toPull({ number: 1 })).toBeUndefined();
    expect(toPull({ number: 1, created_at: "yesterday" })).toBeUndefined();
    expect(toPull("#1")).toBeUndefined();
  });
});

describe("counted, inPeriod", () => {
  const pulls = [
    read(3, { mergedAt: "2026-10-03T00:00:00Z" }),
    read(1, { mergedAt: "2026-10-01T00:00:00Z" }),
    read(2, { mergedAt: null }),
    read(4, { mergedAt: "2026-10-02T00:00:00Z", login: "renovate[bot]" }),
    read(5, { mergedAt: "2026-10-02T00:00:00Z" }),
  ];

  it("counts the merged pull requests not opened by a bot, in the order they were merged", () => {
    expect(counted(pulls).map((p) => p.number)).toEqual([1, 5, 3]);
  });

  it("keeps those merged from since, up to but not at until", () => {
    const since = at("2026-10-02T00:00:00Z");
    expect(inPeriod(pulls, since, at("2026-10-03T00:00:00Z")).map((p) => p.number)).toEqual([5]);
    expect(inPeriod(pulls, since, at("2026-10-03T00:00:01Z")).map((p) => p.number)).toEqual([5, 3]);
  });
});

describe("around", () => {
  const pulls = [1, 2, 3, 4, 5, 6].map((n) =>
    read(n, {
      mergedAt: `2026-10-0${n}T00:00:00Z`,
      login: n === 2 ? "renovate[bot]" : "yokozi-jp",
    }),
  );

  it("takes the pull requests that count, right before and right after the boundary", () => {
    const sides = around(pulls, 4, 2);
    expect(sides?.boundary.number).toBe(4);
    expect(sides?.before.map((p) => p.number)).toEqual([1, 3]);
    expect(sides?.after.map((p) => p.number)).toEqual([5, 6]);
  });

  it("takes only `count` on each side", () => {
    const sides = around(pulls, 4, 1);
    expect(sides?.before.map((p) => p.number)).toEqual([3]);
    expect(sides?.after.map((p) => p.number)).toEqual([5]);
  });

  it("takes fewer when there are not as many", () => {
    const sides = around(pulls, 5, 3);
    expect(sides?.before.map((p) => p.number)).toEqual([1, 3, 4]);
    expect(sides?.after.map((p) => p.number)).toEqual([6]);
  });

  it("has no sides for a pull request that is not merged or not there", () => {
    expect(around([...pulls, read(7, { mergedAt: null })], 7, 2)).toBeUndefined();
    expect(around(pulls, 8, 2)).toBeUndefined();
  });
});

describe("isSampleFile, categoryOf", () => {
  it.each([
    "apps/api/src/app.ts",
    "packages/db/migrations/1.sql",
    "apps/web/index.html",
    "packages/shared-kernel/src/index.ts",
    "apps/api/src/lint/x.ts",
  ])("puts %s, a file of a project in apps/ or packages/, in the sample feature", (path) => {
    expect(isSampleFile(path)).toBe(true);
  });

  it.each([
    "apps/api/lint/test-title-plugin.ts",
    "apps/web/package.json",
    "apps/web/tsconfig.json",
    "apps/api/vite.config.ts",
    "apps/README.md",
    "tools/scripts/src/metrics/cli.ts",
    "tools/apps/api/src/x.ts",
    ".github/workflows/ci.yml",
  ])(
    "puts %s, a lint rule, project config or file outside the projects, in the harness",
    (path) => {
      expect(isSampleFile(path)).toBe(false);
    },
  );

  it("makes a pull request that touches the sample feature a sample one, even with harness files", () => {
    expect(categoryOf([file("README.md"), file("apps/api/src/app.ts")])).toBe("sample");
    expect(categoryOf([file("README.md"), file("apps/api/package.json")])).toBe("harness");
    expect(categoryOf([])).toBe("harness");
  });

  it("reads the old path of a renamed file", () => {
    expect(categoryOf([file("tools/app.ts", "apps/api/src/app.ts")])).toBe("sample");
  });
});

describe("fixes, reworked", () => {
  it("reads the 直す PR field, with one or more pull requests", () => {
    expect(fixes(read(9, { body: "## Summary\r\n\r\n直す PR: #3, #5\r\nCloses #7" }))).toEqual([
      3, 5,
    ]);
    expect(fixes(read(9, { body: "  直す PR：#4  " }))).toEqual([4]);
    expect(fixes(read(9, { body: "直す PR: #\n\nCloses #7" }))).toEqual([]);
    expect(fixes(read(9, { body: "前の 直す PR: #3 を見る" }))).toEqual([]);
  });

  it("reads GitHub's Reverts line of a revert pull request only", () => {
    const body = "Reverts yokozi-jp/agent-software-factory#12\n\n直す PR: #13";
    expect(fixes(read(9, { title: "revert: feat: x", body }))).toEqual([13, 12]);
    expect(fixes(read(9, { title: "revert(api)!: feat: x", body: "Reverts #12" }))).toEqual([12]);
    expect(fixes(read(9, { title: "fix: x", body: "Reverts #12" }))).toEqual([]);
    expect(fixes(read(9, { title: "revert: x", body: "Reverts #12 and more" }))).toEqual([]);
    expect(fixes(read(9, { title: "chore: revert: x", body: "Reverts #12" }))).toEqual([]);
    expect(fixes(read(9, { title: "revert: x", body: "Not Reverts #12" }))).toEqual([]);
  });

  it("marks the pull requests that a later merged pull request fixes, however much later", () => {
    const pulls = [
      read(1, { mergedAt: "2026-01-01T00:00:00Z" }),
      read(2, { mergedAt: "2026-10-01T00:00:00Z", body: "直す PR: #1" }),
      read(3, { mergedAt: "2026-10-02T00:00:00Z" }),
      // Merged before the pull request it names: it cannot fix it.
      read(4, { mergedAt: "2026-10-01T00:00:00Z", body: "直す PR: #3" }),
      // Not merged: no fix yet.
      read(5, { mergedAt: null, body: "直す PR: #2" }),
      // An issue, not a pull request.
      read(6, { mergedAt: "2026-10-03T00:00:00Z", body: "直す PR: #99" }),
      // Naming itself, or one merged at the same time: not after it.
      read(7, { mergedAt: "2026-10-04T00:00:00Z", body: "直す PR: #7, #8" }),
      read(8, { mergedAt: "2026-10-04T00:00:00Z" }),
    ];
    expect([...reworked(pulls)]).toEqual([1]);
  });
});

describe("pushes", () => {
  const target = merged(7, { createdAt: "2026-10-01T00:00:00Z", mergedAt: "2026-10-01T05:00:00Z" });

  it("finds each head commit with pull_request runs, pushed when its first run was created", () => {
    const runs = [
      run("b", "2026-10-01T02:00:05Z"),
      run("a", "2026-10-01T00:00:03Z"),
      run("b", "2026-10-01T02:00:00Z"),
      run("a", "2026-10-01T00:30:00Z"),
    ];
    expect(pushes(runs, target)).toEqual([
      { sha: "a", pushedAt: at("2026-10-01T00:00:03Z") },
      { sha: "b", pushedAt: at("2026-10-01T02:00:00Z") },
    ]);
  });

  it("keeps the runs of other events and outside the time the pull request was open out", () => {
    const runs = [
      run("push", "2026-10-01T01:00:00Z", "push"),
      run("early", "2026-09-30T23:59:59Z"),
      run("late", "2026-10-01T05:00:01Z"),
      run("first", "2026-10-01T00:00:00Z"),
      run("last", "2026-10-01T05:00:00Z"),
      { event: "pull_request", created_at: "2026-10-01T01:00:00Z" },
      { event: "pull_request", head_sha: "no-time", created_at: null },
    ];
    expect(pushes(runs, target).map((push) => push.sha)).toEqual(["first", "last"]);
  });
});

describe("feedbackLoop", () => {
  const required = [
    { context: "main", app: 15368 },
    { context: "commitlint", app: undefined },
  ];
  const pushedAt = at("2026-10-01T00:00:00Z");

  it("is the time until the last required check finished", () => {
    const runs = [
      checkRun("main", "2026-10-01T00:03:00Z"),
      checkRun("commitlint", "2026-10-01T00:01:00Z"),
      checkRun("CodeQL", "2026-10-01T00:09:00Z", "success", 57789),
    ];
    expect(feedbackLoop(pushedAt, runs, required)).toBe(3 * 60_000);
  });

  it("takes the first finish of a check that ran again, failed or not, and skips cancelled runs", () => {
    const runs = [
      checkRun("main", "2026-10-01T00:05:00Z"),
      checkRun("main", "2026-10-01T00:02:00Z", "failure"),
      checkRun("commitlint", "2026-10-01T00:01:00Z", "cancelled"),
      checkRun("commitlint", "2026-10-01T00:04:00Z"),
    ];
    expect(feedbackLoop(pushedAt, runs, required)).toBe(4 * 60_000);
  });

  it("is undefined while a required check runs, or when it was only cancelled", () => {
    const main = checkRun("main", "2026-10-01T00:02:00Z");
    expect(
      feedbackLoop(pushedAt, [main, checkRun("commitlint", null, null)], required),
    ).toBeUndefined();
    expect(
      feedbackLoop(
        pushedAt,
        [main, checkRun("commitlint", "2026-10-01T00:01:00Z", "cancelled")],
        required,
      ),
    ).toBeUndefined();
  });

  it("counts a required check only from the app the ruleset names", () => {
    const runs = [
      checkRun("main", "2026-10-01T00:02:00Z", "success", 1),
      checkRun("commitlint", "2026-10-01T00:01:00Z"),
    ];
    expect(feedbackLoop(pushedAt, runs, required)).toBeUndefined();
    expect(
      feedbackLoop(
        pushedAt,
        [{ name: "main", completed_at: "2026-10-01T00:02:00Z" }],
        required.slice(0, 1),
      ),
    ).toBeUndefined();
  });

  it("is never below zero", () => {
    expect(
      feedbackLoop(pushedAt, [checkRun("commitlint", "2026-09-30T23:59:00Z")], required.slice(1)),
    ).toBe(0);
  });
});

describe("summarize", () => {
  const sample = (
    number: number,
    category: Sample["category"],
    labels: string[],
    loops: number[],
  ): Sample => ({
    pull: merged(number, { labels }),
    category,
    loops: loops.map((ms) => ({ pushedAt: 0, ms })),
  });

  it("counts the pull requests of each category, those without rework, and those reworked", () => {
    const samples = [
      sample(1, "sample", ["rework"], [10, 20]),
      sample(2, "sample", ["bug"], [30]),
      sample(3, "harness", [], []),
    ];
    expect(summarize(samples, new Set([2, 3, 99]))).toEqual({
      sample: { pulls: 2, firstPass: 1, reworked: 1, loops: [10, 20, 30] },
      harness: { pulls: 1, firstPass: 1, reworked: 1, loops: [] },
    });
  });
});

describe("quantile", () => {
  it("interpolates between the nearest ranks", () => {
    expect(quantile([40, 10, 30, 20], 0.5)).toBe(25);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
    expect(quantile([5, 1, 3], 0.5)).toBe(3);
    expect(quantile([7], 0.9)).toBe(7);
  });

  it("has none for no values", () => {
    expect(quantile([], 0.5)).toBeUndefined();
  });
});
