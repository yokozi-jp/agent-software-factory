import { describe, expect, it } from "vite-plus/test";
import {
  blockersInBody,
  edgeProblems,
  ghFailed,
  implementationProblems,
  parseChildren,
  parseIssues,
  parseNumbers,
  parseStrings,
  pathProblems,
  report,
  shallow,
  stalePaths,
  ticketsToRead,
  withDirectories,
  type Child,
} from "./rules.ts";

const repo = "owner/name";
const url = (number: number, repository = repo): string =>
  `https://github.com/${repository}/issues/${number}`;

describe("withDirectories", () => {
  it("lists each file and every directory above it", () => {
    expect(withDirectories(["a/b/c.ts", "d.ts", "a/e.ts"])).toEqual(
      new Set(["a", "a/b", "a/b/c.ts", "d.ts", "a/e.ts"]),
    );
  });
});

describe("stalePaths", () => {
  const paths = {
    existing: withDirectories(["tools/scripts/src/rules.ts", "docs/index.md", "README.md"]),
    removed: withDirectories([
      "scripts/check-policy.sh",
      "scripts/test/checks.test.sh",
      "old/rules.ts",
      "old/notes.md2",
      "notes/gone.md",
    ]),
  };
  const stale = (body: string): string[] => stalePaths(body, paths);

  it("reports a removed file, and a removed directory written with a trailing slash", () => {
    expect(stale("Run `scripts/check-policy.sh`, see `scripts/` and `notes/gone.md`.")).toEqual([
      "scripts/check-policy.sh",
      "scripts",
      "notes/gone.md",
    ]);
  });

  it("drops a leading ./ but no other ./", () => {
    expect(stale("`./scripts/test/`")).toEqual(["scripts/test"]);
    expect(stale("`scripts/./test`")).toEqual([]);
  });

  it("reports each path once", () => {
    expect(stale("`scripts/` `scripts/` `scripts`")).toEqual(["scripts"]);
  });

  it("does not report a path the tree has, or one that never existed", () => {
    expect(stale("`docs/index.md` `tools/scripts/` `packages/i18n` `notes/new.md`")).toEqual([]);
  });

  it("reports a bare file name only when a removed file had it and no file of the tree has it", () => {
    expect(stale("`check-policy.sh` `rules.ts` `README.md` `never.sh`")).toEqual([
      "check-policy.sh",
    ]);
  });

  it("does not take a bare word without an extension for a path", () => {
    expect(stale("`old` `test` `notes.md2`")).toEqual([]);
  });

  it("reads inline code only, outside fenced code blocks", () => {
    const body = [
      "scripts/check-policy.sh in prose",
      "```sh",
      "scripts/test/checks.test.sh `scripts/test`",
      "```",
      "after the block: `scripts/check-policy.sh`, and a line that ends with ```",
      "`notes/gone.md`",
      "```",
      "`scripts/`",
      "```",
    ].join("\n");
    expect(stale(body)).toEqual(["scripts/check-policy.sh", "notes/gone.md"]);
  });

  it("does not read a span across lines", () => {
    expect(stale("a `scripts\n/test b\n`notes/gone.md`")).toEqual(["notes/gone.md"]);
  });
});

describe("pathProblems", () => {
  it("names the issue and the path", () => {
    expect(pathProblems({ number: 7, title: "T", body: "" }, ["scripts"])).toEqual([
      "#7 「T」: `scripts` was removed from the repository. Rewrite the body with the path it moved to.",
    ]);
  });
});

const child = (
  number: number,
  labels: string[],
  state = "closed",
  stateReason = "completed",
): Child => ({
  number,
  title: `T${number}`,
  state,
  stateReason,
  labels,
});
const grilling = ["wayfinder:grilling"];

describe("ticketsToRead", () => {
  const map = [
    "## Decisions so far",
    "",
    `- [A](${url(1)}): decided. 実施: [X](${url(90)})`,
    `- [B](${url(2)}): decided.`,
    `- [C](${url(30)}): decided, see [A](${url(1)}).`,
    "",
    "## Not yet specified",
    "",
    `- fog about [D](${url(4)}): 実施 later`,
  ].join("\n");

  it("returns the closed decision tickets whose line does not mention 実施, or that have no line", () => {
    const children = [
      child(1, grilling),
      child(2, ["bug", "wayfinder:grilling"]),
      child(3, ["wayfinder:prototype"]),
      child(4, grilling),
    ];
    expect(ticketsToRead(map, children, new Set()).map(({ number }) => number)).toEqual([2, 3, 4]);
  });

  it("matches the line by the whole issue number", () => {
    expect(ticketsToRead(map, [child(3, grilling)], new Set()).map(({ number }) => number)).toEqual(
      [3],
    );
  });

  it("skips open, not planned, exempt, and research or task tickets", () => {
    const children = [
      child(2, grilling, "open", "completed"),
      child(5, grilling, "closed", "not_planned"),
      child(6, grilling),
      child(7, ["wayfinder:research"]),
      child(8, ["wayfinder:task", "bug"]),
    ];
    expect(ticketsToRead(map, children, new Set([6]))).toEqual([]);
  });

  it("reads every ticket when the map has no Decisions so far, whatever other lines say", () => {
    const body = `- [A](${url(1)}): 実施\n## Notes`;
    expect(ticketsToRead(body, [child(1, grilling)], new Set()).length).toBe(1);
  });

  it("reads to the end of the body when Decisions so far is the last section", () => {
    const last = `## Notes\n## Decisions so far\n- [A](${url(1)}): 実施: none`;
    expect(ticketsToRead(last, [child(1, grilling)], new Set())).toEqual([]);
  });
});

describe("implementationProblems", () => {
  it("reports the tickets whose comments do not mention 実施 either, with the map", () => {
    const comments = new Map([
      [1, ["decided", "実施の Issue は作らない"]],
      [2, ["decided"]],
    ]);
    expect(
      implementationProblems(
        23,
        [child(1, grilling), child(2, grilling), child(3, grilling)],
        comments,
      ),
    ).toEqual([
      `#2 「T2」 (map #23): closed without its implementation issue. Create it and link it from the resolution comment and the Decisions so far line ("実施: ..."), or write there that none is needed ("実施の Issue は作らない").`,
      `#3 「T3」 (map #23): closed without its implementation issue. Create it and link it from the resolution comment and the Decisions so far line ("実施: ..."), or write there that none is needed ("実施の Issue は作らない").`,
    ]);
  });
});

describe("blockersInBody", () => {
  it("reads the links and #numbers of a Blocked by: line, of this repository only", () => {
    const body = [
      "intro naming #1",
      `Blocked by: [A](${url(171)})、#12 and [B](${url(5, "other/repo")}), not issue#9 or a/#8`,
      ` Blocked by: #13`,
      `## Blocked by`,
      `Blocked by: [C](${url(171)}) [D](${url(20, "owner/name-two")})`,
    ].join("\n");
    expect(blockersInBody(body, repo)).toEqual([171, 12]);
  });

  it("does not count an issue named in a note in full-width parentheses", () => {
    const body = `Blocked by: [A](${url(171)})（決定は [B](${url(75)}) と #76）、#77（前提）`;
    expect(blockersInBody(body, repo)).toEqual([171, 77]);
  });

  it("matches the repository exactly", () => {
    expect(blockersInBody(`Blocked by: [A](${url(3, "owner/nam")})`, repo)).toEqual([]);
  });
});

describe("edgeProblems", () => {
  it("reports each blocker of the body that is not a native edge", () => {
    expect(edgeProblems({ number: 9, title: "T", body: "" }, [1, 2, 3], [2])).toEqual([
      `#9 「T」: "Blocked by:" names #1, but GitHub has no native edge. Add it (docs/agents/issue-tracker.md ("Wayfinding operations")).`,
      `#9 「T」: "Blocked by:" names #3, but GitHub has no native edge. Add it (docs/agents/issue-tracker.md ("Wayfinding operations")).`,
    ]);
  });
});

describe("report", () => {
  it("passes with no problems", () => {
    expect(report([])).toEqual({ status: 0, stdout: "issue-tracker: no problems\n", stderr: "" });
  });

  it("fails with one line per problem", () => {
    expect(report(["a", "b"])).toEqual({
      status: 1,
      stdout: "",
      stderr: "issue-tracker: a\nissue-tracker: b\n",
    });
  });

  it("says what gh could not read, and why a shallow clone stops the check", () => {
    expect(ghFailed("the maps")).toEqual({
      status: 2,
      stdout: "",
      stderr:
        "issue-tracker: could not read the maps with gh. Check `gh auth status` and try again.\n",
    });
    expect(shallow).toEqual({
      status: 2,
      stdout: "",
      stderr:
        "issue-tracker: the clone is shallow, so the removed paths are unknown. Fetch the full history (actions/checkout with fetch-depth: 0).\n",
    });
  });
});

describe("parseIssues", () => {
  it("reads the issues", () => {
    expect(parseIssues('[{"number":1,"title":"T","body":"B","extra":0}]')).toEqual([
      { number: 1, title: "T", body: "B" },
    ]);
  });

  it("returns undefined for anything else", () => {
    for (const json of [
      "{}",
      "[null]",
      '[{"number":"1","title":"T","body":"B"}]',
      '[{"number":1,"title":2,"body":"B"}]',
      '[{"number":1,"title":"T","body":null}]',
    ])
      expect(parseIssues(json)).toBeUndefined();
  });
});

describe("parseChildren", () => {
  it("reads one object per line, with a null state_reason as empty", () => {
    const lines = [
      '{"number":1,"title":"T","state":"open","state_reason":null,"labels":["a"]}',
      "",
      '{"number":2,"title":"U","state":"closed","state_reason":"completed","labels":[]}',
      "",
    ].join("\n");
    expect(parseChildren(lines)).toEqual([
      { number: 1, title: "T", state: "open", stateReason: "", labels: ["a"] },
      { number: 2, title: "U", state: "closed", stateReason: "completed", labels: [] },
    ]);
  });

  it("returns undefined when a line is not a ticket", () => {
    const ok = { number: 1, title: "T", state: "open", state_reason: "x", labels: ["a"] };
    for (const bad of [
      { ...ok, number: "1" },
      { ...ok, title: 1 },
      { ...ok, state: null },
      { ...ok, state_reason: 1 },
      { ...ok, labels: "a" },
      { ...ok, labels: [1] },
    ])
      expect(parseChildren(JSON.stringify(bad))).toBeUndefined();
  });
});

describe("parseStrings and parseNumbers", () => {
  it("read an array of strings or of numbers, and nothing else", () => {
    expect(parseStrings('["a","b"]')).toEqual(["a", "b"]);
    expect(parseStrings('["a",1]')).toBeUndefined();
    expect(parseStrings('"a"')).toBeUndefined();
    expect(parseNumbers("[1,2]")).toEqual([1, 2]);
    expect(parseNumbers('[1,"2"]')).toBeUndefined();
    expect(parseNumbers("1")).toBeUndefined();
  });
});
