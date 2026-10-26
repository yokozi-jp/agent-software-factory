import { describe, expect, it } from "vite-plus/test";
import type { Category, Sample } from "./metrics.ts";
import { boundaryReport, periodReport } from "./report.ts";

const at = (iso: string): number => Date.parse(iso);
const minute = 60_000;

const sample = (
  number: number,
  category: Category,
  fields: { title?: string; mergedAt: string; labels?: string[]; loops?: [string, number][] },
): Sample => ({
  pull: {
    number,
    title: fields.title ?? `docs: change ${number}`,
    body: "",
    bot: false,
    labels: fields.labels ?? [],
    branch: `branch-${number}`,
    createdAt: at("2026-09-01T00:00:00Z"),
    mergedAt: at(fields.mergedAt),
  },
  category,
  loops: (fields.loops ?? []).map(([pushedAt, ms]) => ({ pushedAt: at(pushedAt), ms })),
});

const header = "| 指標 | サンプル機能の PR | ハーネスの PR |\n| --- | --- | --- |\n";

describe("periodReport", () => {
  it("shows each month's rates beside its harness pull requests, then the feedback loop of each week", () => {
    const samples = [
      // Pushed on Monday 2026-10-05 in JST (01:00 and 09:00), though 01:00 JST is still Sunday in UTC.
      sample(10, "sample", {
        mergedAt: "2026-10-05T03:00:00Z",
        labels: ["rework"],
        loops: [
          ["2026-10-05T00:00:00Z", 6 * minute],
          ["2026-10-04T16:00:00Z", 10 * minute],
        ],
      }),
      sample(11, "harness", {
        title: "ci: x",
        mergedAt: "2026-10-06T00:00:00Z",
        loops: [["2026-09-30T12:00:00Z", 3 * minute]],
      }),
      sample(12, "harness", { title: "docs: y", mergedAt: "2026-10-20T00:00:00Z" }),
    ];
    const report = periodReport({
      since: at("2026-08-31T15:00:00Z"),
      until: at("2026-10-31T15:00:00Z"),
      samples,
      reworked: new Set([12, 99]),
    });
    expect(report).toBe(
      [
        "# 工場の成果の指標: 2026-09-01 から 2026-10-31 まで",
        "",
        "merge した日 (JST) で PR を数えます。bot の PR は数えません。定義は docs/agents/factory-metrics.md にあります。",
        "",
        "## 2026-09",
        "",
        `${header}| first-pass acceptance | — | — |`,
        "| 手戻りの割合 | — | — |",
        "",
        "その月に merge されたハーネスの PR: なし",
        "",
        "## 2026-10",
        "",
        `${header}| first-pass acceptance | 0% (0/1) | 100% (2/2) |`,
        "| 手戻りの割合 | 0% (0/1) | 50% (1/2) |",
        "",
        "その月に merge されたハーネスの PR:",
        "",
        "- 2026-10-06 #11 ci: x",
        "- 2026-10-20 #12 docs: y",
        "",
        "## CI の feedback loop の時間 (週ごと)",
        "",
        "期間に merge された PR への push を、push した週 (月曜から、JST) で分けます。",
        "",
        "| 週 | サンプル機能の PR | ハーネスの PR |",
        "| --- | --- | --- |",
        "| 2026-09-28 | — | 中央値 3.0 分、p90 3.0 分 (push 1) |",
        "| 2026-10-05 | 中央値 8.0 分、p90 9.6 分 (push 2) | — |",
        "",
      ].join("\n"),
    );
  });

  it("says so when no push had all its required checks finish", () => {
    const report = periodReport({
      since: at("2026-09-30T15:00:00Z"),
      until: at("2026-10-01T15:00:00Z"),
      samples: [],
      reworked: new Set(),
    });
    expect(report).toBe(
      [
        "# 工場の成果の指標: 2026-10-01 から 2026-10-01 まで",
        "",
        "merge した日 (JST) で PR を数えます。bot の PR は数えません。定義は docs/agents/factory-metrics.md にあります。",
        "",
        "## 2026-10",
        "",
        `${header}| first-pass acceptance | — | — |`,
        "| 手戻りの割合 | — | — |",
        "",
        "その月に merge されたハーネスの PR: なし",
        "",
        "## CI の feedback loop の時間 (週ごと)",
        "",
        "期間に merge された PR への push を、push した週 (月曜から、JST) で分けます。",
        "",
        "必須チェックがすべて終わった push がありません。",
        "",
      ].join("\n"),
    );
  });
});

describe("boundaryReport", () => {
  const boundary = sample(20, "harness", { mergedAt: "2026-10-10T00:00:00Z" }).pull;

  it("shows the values of the pull requests before and after the boundary, with the feedback loop", () => {
    const before = [
      sample(17, "harness", {
        mergedAt: "2026-10-08T00:00:00Z",
        labels: ["rework"],
        loops: [
          ["2026-10-07T00:00:00Z", 3 * minute],
          ["2026-10-07T01:00:00Z", 1 * minute],
          ["2026-10-07T02:00:00Z", 2 * minute],
        ],
      }),
      sample(18, "harness", { mergedAt: "2026-10-09T00:00:00Z" }),
      sample(19, "harness", { mergedAt: "2026-10-09T01:00:00Z" }),
    ];
    const after = [
      sample(21, "sample", {
        mergedAt: "2026-10-11T00:00:00Z",
        loops: [["2026-10-10T00:00:00Z", 90_000]],
      }),
    ];
    const report = boundaryReport({ boundary, count: 3, before, after, reworked: new Set([19]) });
    expect(report).toBe(
      [
        "# 工場の成果の指標: #20 の前後 3 件",
        "",
        "merge した順に、#20 (2026-10-10 に merge) の前と後の PR を数えます。#20 自身と bot の PR は数えません。定義は docs/agents/factory-metrics.md にあります。",
        "",
        "## #20 より前 (2026-10-08 から 2026-10-09 に merge)",
        "",
        `${header}| first-pass acceptance | — | 67% (2/3) |`,
        "| 手戻りの割合 | — | 33% (1/3) |",
        "| CI の feedback loop の時間 | — | 中央値 2.0 分、p90 2.8 分 (push 3) |",
        "",
        "## #20 より後 (2026-10-11 から 2026-10-11 に merge)",
        "",
        `${header}| first-pass acceptance | 100% (1/1) | — |`,
        "| 手戻りの割合 | 0% (0/1) | — |",
        "| CI の feedback loop の時間 | 中央値 1.5 分、p90 1.5 分 (push 1) | — |",
        "",
      ].join("\n"),
    );
  });

  it("says so for a side without pull requests", () => {
    const report = boundaryReport({
      boundary,
      count: 2,
      before: [],
      after: [],
      reworked: new Set(),
    });
    expect(report).toBe(
      [
        "# 工場の成果の指標: #20 の前後 2 件",
        "",
        "merge した順に、#20 (2026-10-10 に merge) の前と後の PR を数えます。#20 自身と bot の PR は数えません。定義は docs/agents/factory-metrics.md にあります。",
        "",
        "## #20 より前",
        "",
        "merge された PR がありません。",
        "",
        "## #20 より後",
        "",
        "merge された PR がありません。",
        "",
      ].join("\n"),
    );
  });
});
