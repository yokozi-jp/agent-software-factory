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
  it("--slurp が出力する配列のページを連結すること", () => {
    expect(items([[1, 2], [3]])).toEqual([1, 2, 3]);
  });

  it("各ページが key の下に持つ配列を連結すること", () => {
    const pages = [
      { total_count: 3, workflow_runs: [1, 2] },
      { total_count: 3, workflow_runs: [3] },
    ];
    expect(items(pages, "workflow_runs")).toEqual([1, 2, 3]);
  });

  it("items のページではないものを読み飛ばすこと", () => {
    expect(items({ workflow_runs: [1] }, "workflow_runs")).toEqual([]);
    expect(items([{ other: [1] }, "page", [2]], "workflow_runs")).toEqual([]);
    expect(items([{ x: 1 }, [2]])).toEqual([2]);
  });
});

describe("requiredChecks", () => {
  it("ruleset から必須チェックとその app を読むこと", () => {
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

  it("規則のない ruleset や、ruleset ではないものからは何も見つけないこと", () => {
    expect(requiredChecks({ rules: [{ type: "deletion" }] })).toEqual([]);
    expect(requiredChecks({ rules: [{ type: "required_status_checks" }] })).toEqual([]);
    expect(requiredChecks([])).toEqual([]);
    expect(requiredChecks(null)).toEqual([]);
  });

  it("名前のないチェックを読み飛ばすこと", () => {
    const checks = [{ context: 7 }, { context: "main" }];
    const rules = [
      { type: "required_status_checks", parameters: { required_status_checks: checks } },
    ];
    expect(requiredChecks({ rules })).toEqual([{ context: "main", app: undefined }]);
  });
});

describe("toPull", () => {
  it("pull request の項目を読むこと", () => {
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

  it("bot の pull request に印を付け、merge せず閉じたものを読むこと", () => {
    const parsed = toPull(pull(5, { login: "renovate[bot]", mergedAt: null }));
    expect(parsed?.bot).toBe(true);
    expect(parsed?.mergedAt).toBeUndefined();
  });

  it("ない body、title、user、labels、branch を空として読むこと", () => {
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

  it("番号または作成時刻のないものを拒否すること", () => {
    expect(toPull({ created_at: "2026-10-01T00:00:00Z" })).toBeUndefined();
    expect(toPull({ number: 1 })).toBeUndefined();
    expect(toPull({ number: 1, created_at: "yesterday" })).toBeUndefined();
    expect(toPull("#1")).toBeUndefined();
  });
});

describe("counted と inPeriod", () => {
  const pulls = [
    read(3, { mergedAt: "2026-10-03T00:00:00Z" }),
    read(1, { mergedAt: "2026-10-01T00:00:00Z" }),
    read(2, { mergedAt: null }),
    read(4, { mergedAt: "2026-10-02T00:00:00Z", login: "renovate[bot]" }),
    read(5, { mergedAt: "2026-10-02T00:00:00Z" }),
  ];

  it("bot が開いていない merge された pull request を、merge された順に数えること", () => {
    expect(counted(pulls).map((p) => p.number)).toEqual([1, 5, 3]);
  });

  it("since 以降 until より前に merge されたものを残すこと", () => {
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

  it("境界の直前と直後の、数える pull request を採ること", () => {
    const sides = around(pulls, 4, 2);
    expect(sides?.boundary.number).toBe(4);
    expect(sides?.before.map((p) => p.number)).toEqual([1, 3]);
    expect(sides?.after.map((p) => p.number)).toEqual([5, 6]);
  });

  it("各側から `count` 件だけを採ること", () => {
    const sides = around(pulls, 4, 1);
    expect(sides?.before.map((p) => p.number)).toEqual([3]);
    expect(sides?.after.map((p) => p.number)).toEqual([5]);
  });

  it("足りないとき、少なく採ること", () => {
    const sides = around(pulls, 5, 3);
    expect(sides?.before.map((p) => p.number)).toEqual([1, 3, 4]);
    expect(sides?.after.map((p) => p.number)).toEqual([6]);
  });

  it("merge されていない、またはない pull request には、側がないこと", () => {
    expect(around([...pulls, read(7, { mergedAt: null })], 7, 2)).toBeUndefined();
    expect(around(pulls, 8, 2)).toBeUndefined();
  });
});

describe("isSampleFile と categoryOf", () => {
  it.each([
    "apps/api/src/app.ts",
    "packages/db/migrations/1.sql",
    "apps/web/index.html",
    "packages/shared-kernel/src/index.ts",
    "apps/api/src/lint/x.ts",
  ])("apps/ か packages/ の project のファイルである %s を、sample の機能に分けること", (path) => {
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
    "lint の規則、project の設定、project の外のファイルである %s を、harness に分けること",
    (path) => {
      expect(isSampleFile(path)).toBe(false);
    },
  );

  it("harness のファイルがあっても、sample の機能に触れる pull request を sample にすること", () => {
    expect(categoryOf([file("README.md"), file("apps/api/src/app.ts")])).toBe("sample");
    expect(categoryOf([file("README.md"), file("apps/api/package.json")])).toBe("harness");
    expect(categoryOf([])).toBe("harness");
  });

  it("改名したファイルの元の path を読むこと", () => {
    expect(categoryOf([file("tools/app.ts", "apps/api/src/app.ts")])).toBe("sample");
  });
});

describe("fixes と reworked", () => {
  it("reads the 直す PR field, with one or more pull requests", () => {
    expect(fixes(read(9, { body: "## Summary\r\n\r\n直す PR: #3, #5\r\nCloses #7" }))).toEqual([
      3, 5,
    ]);
    expect(fixes(read(9, { body: "  直す PR：#4  " }))).toEqual([4]);
    expect(fixes(read(9, { body: "直す PR: #\n\nCloses #7" }))).toEqual([]);
    expect(fixes(read(9, { body: "前の 直す PR: #3 を見る" }))).toEqual([]);
  });

  it("revert の pull request の GitHub の Reverts の行だけを読むこと", () => {
    const body = "Reverts yokozi-jp/agent-software-factory#12\n\n直す PR: #13";
    expect(fixes(read(9, { title: "revert: feat: x", body }))).toEqual([13, 12]);
    expect(fixes(read(9, { title: "revert(api)!: feat: x", body: "Reverts #12" }))).toEqual([12]);
    expect(fixes(read(9, { title: "fix: x", body: "Reverts #12" }))).toEqual([]);
    expect(fixes(read(9, { title: "revert: x", body: "Reverts #12 and more" }))).toEqual([]);
    expect(fixes(read(9, { title: "chore: revert: x", body: "Reverts #12" }))).toEqual([]);
    expect(fixes(read(9, { title: "revert: x", body: "Not Reverts #12" }))).toEqual([]);
  });

  it("後の merge された pull request が直す pull request に、どれだけ後でも印を付けること", () => {
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

  it("pull_request の run を持つ各 head commit を、最初の run が作られた時刻を push の時刻として見つけること", () => {
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

  it("ほかのイベントの run と、pull request が open だった時間の外の run を除くこと", () => {
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

  it("最後の必須チェックが終わるまでの時間であること", () => {
    const runs = [
      checkRun("main", "2026-10-01T00:03:00Z"),
      checkRun("commitlint", "2026-10-01T00:01:00Z"),
      checkRun("CodeQL", "2026-10-01T00:09:00Z", "success", 57789),
    ];
    expect(feedbackLoop(pushedAt, runs, required)).toBe(3 * 60_000);
  });

  it("再実行されたチェックの最初の終了を、失敗かどうかにかかわらず採り、cancel された run を読み飛ばすこと", () => {
    const runs = [
      checkRun("main", "2026-10-01T00:05:00Z"),
      checkRun("main", "2026-10-01T00:02:00Z", "failure"),
      checkRun("commitlint", "2026-10-01T00:01:00Z", "cancelled"),
      checkRun("commitlint", "2026-10-01T00:04:00Z"),
    ];
    expect(feedbackLoop(pushedAt, runs, required)).toBe(4 * 60_000);
  });

  it("必須チェックが実行中、または cancel されただけのとき、undefined であること", () => {
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

  it("ruleset が名指す app の必須チェックだけを数えること", () => {
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

  it("0 を下回らないこと", () => {
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

  it("各カテゴリ、手戻りのないもの、手戻りのあったものの pull request を数えること", () => {
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
  it("最も近い順位の間を補間すること", () => {
    expect(quantile([40, 10, 30, 20], 0.5)).toBe(25);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
    expect(quantile([5, 1, 3], 0.5)).toBe(3);
    expect(quantile([7], 0.9)).toBe(7);
  });

  it("値がないとき、何も返さないこと", () => {
    expect(quantile([], 0.5)).toBeUndefined();
  });
});
