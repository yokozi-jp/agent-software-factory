import { describe, expect, it } from "vite-plus/test";
import {
  countTests,
  finding,
  findingLines,
  isTestFile,
  skipped,
  testChanges,
  warning,
} from "./rules.ts";

const guide = 'docs/code-review/agent-pull-requests.md ("人が判断するもの")';
const guideUrl =
  "https://github.com/yokozi-jp/agent-software-factory/blob/main/docs/code-review/agent-pull-requests.md#人が判断するもの";
const fix =
  "If a test failed after your change, fix the code or the test instead of removing it. If the test is no longer needed, say why in the pull request body: a reviewer reads this pull request before merging it.";

describe("isTestFile", () => {
  it.each([
    "a.test.ts",
    "apps/api/src/app.test.ts",
    "apps/web/src/routes/index.test.tsx",
    "tools/scripts/src/sh/osv-scanner.tools.test.ts",
    "x.spec.ts",
    "x.test.js",
    "x.test.mjs",
    "x.test.cts",
    "x.test.jsx",
  ])("%s をテストファイルに数えること", (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each([
    "apps/api/src/app.ts",
    "test.ts",
    "x.test.ts.orig",
    "x.test.json",
    "x.test.d.ts.map",
    "x-test.ts",
    "tools/scripts/src/test/sandbox.ts",
    "tools/scripts/src/test/fixtures/expect.test.ts",
    "fixtures/a.test.ts",
    "apps/api/__fixtures__/a.test.ts",
  ])("%s を数えないこと", (path) => {
    expect(isTestFile(path)).toBe(false);
  });

  it("名前に fixtures を含むだけのディレクトリを数えること", () => {
    expect(isTestFile("my-fixtures/a.test.ts")).toBe(true);
    expect(isTestFile("fixtures-old/a.test.ts")).toBe(true);
  });
});

describe("testChanges", () => {
  // The argument is the `git diff --name-status --find-renames` output from the merge base to one commit.
  it("削除、変更、改名したテストファイルを、順序どおり残すこと", () => {
    const diff = [
      "D\ta.test.ts",
      "M\tsrc/b.test.ts",
      "R087\told.test.ts\tnew.test.ts",
      "T\tc.test.ts",
      "",
    ].join("\n");
    expect(testChanges(diff)).toEqual([
      { from: "a.test.ts", to: undefined },
      { from: "src/b.test.ts", to: "src/b.test.ts" },
      { from: "old.test.ts", to: "new.test.ts" },
      { from: "c.test.ts", to: "c.test.ts" },
    ]);
  });

  it("テストではないファイルに名前を変えたテストファイルを、削除として扱うこと", () => {
    expect(testChanges("R100\ta.test.ts\tfixtures/a.test.ts\n")).toEqual([
      { from: "a.test.ts", to: undefined },
    ]);
  });

  it("足したテストファイルと、テストではないファイルを除くこと", () => {
    const diff = "A\tnew.test.ts\nM\tsrc/app.ts\nD\tsrc/old.ts\nR100\tsrc/x.ts\tsrc/x.test.ts\n";
    expect(testChanges(diff)).toEqual([]);
  });

  it("空の入力から何も読まないこと", () => {
    expect(testChanges("")).toEqual([]);
  });

  it("git が出力する形の行全体だけを読むこと", () => {
    const diff = ["xM\ta.test.ts", "M a.test.ts", "Ma\tb.test.ts", "R1\tc.test.ts\td.test.ts\te"];
    expect(testChanges(diff.join("\n"))).toEqual([]);
  });

  it("空白や ASCII でない名前を含む path を残すこと", () => {
    expect(testChanges("M\tsrc/ログイン の.test.ts\n")).toEqual([
      { from: "src/ログイン の.test.ts", to: "src/ログイン の.test.ts" },
    ]);
  });
});

describe("countTests", () => {
  it("と test の呼び出しを数えること", () => {
    expect(countTests('it("a", () => {});\ntest("b", () => {});\n')).toBe(2);
  });

  it("テストのないファイルでは、何も数えないこと", () => {
    expect(countTests('describe("a", () => {});\nconst x = 1;\n')).toBe(0);
  });

  it("表を 1 つと数えること", () => {
    expect(countTests('it.each([1, 2, 3])("a %s", () => {});\ntest.for([1])("b", () => {});')).toBe(
      2,
    );
  });

  it.each([
    "it.concurrent",
    "test.sequential",
    "it.fails",
    "it.only",
    "test.runIf(true)",
    "test.skipIf(false)",
    "it.concurrent.each([1])",
  ])("%s を実行されるテストとして数えること", (call) => {
    expect(countTests(`${call}("a", () => {});`)).toBe(1);
  });

  it.each(["it.skip", "test.todo", "it.concurrent.skip", "test.extend({})", "test.scoped({})"])(
    "%s を数えないこと",
    (call) => {
      expect(countTests(`${call}("a", () => {});`)).toBe(0);
    },
  );

  it("や test という名前のメソッドやプロパティを数えないこと", () => {
    expect(
      countTests('if (/x/.test(path)) items.it("a");\nconst $test = 1; mytest("b"); _it("c");'),
    ).toBe(0);
  });

  it("括弧の前に空白のある呼び出しを数えないこと", () => {
    expect(countTests('it ("a", () => {});')).toBe(0);
  });

  it("行コメントとブロックコメントを除くこと", () => {
    const source = [
      '// it("commented out", () => {});',
      '  // test("indented", () => {});',
      '/* it("block", () => {});',
      'test("still a comment", () => {}); */',
      'it("kept", () => {});',
      '/** it("doc") */ it("after a comment", () => {});',
    ].join("\n");
    expect(countTests(source)).toBe(2);
  });

  it("コメントを空白で埋めずに取り除くので、メソッド呼び出しがメソッド呼び出しのままであること", () => {
    expect(countTests('items./* note */it("a", () => {});')).toBe(0);
  });

  it.each([
    ["a double-quoted string", 'const glob = "@/*"; it("a", () => {});'],
    ["a single-quoted string", "const glob = './src/*'; it('a', () => {});"],
    ["a template literal", "const glob = `src/${name}/*`; it('a', () => {});"],
    ["a string with an escaped quote", 'const s = "a\\"/*"; it("a", () => {});'],
  ])("%s の中の /* の後にあるテストを残すこと", (_name, source) => {
    expect(countTests(source)).toBe(1);
  });

  // A string of several characters must be read whole: if it were not, the `/*` inside it would
  // start a comment that the `*/` of the next string ends, and the test between them would be lost.
  it.each([
    ["double-quoted", '"@/*"', '"*/"'],
    ["single-quoted", "'@/*'", "'*/'"],
    ["template", "`@/*`", "`*/`"],
  ])("複数文字の %s の文字列を 1 つのリテラルとして読むこと", (_name, open, close) => {
    expect(countTests(`const a = ${open}; it("a", () => {}); const b = ${close};`)).toBe(1);
  });

  it("見積もりが言うとおり、文字列の中に書いた宣言を数えること", () => {
    expect(countTests("const text = \"it('a', () => {})\";")).toBe(1);
  });

  it("コードの後の // を、単独の行のコメントと取り違えないこと", () => {
    expect(countTests('const re = /https?:\\/\\//; it("a", () => {});')).toBe(1);
  });

  it("文字列の後に来るブロックコメントを引き続き除くこと", () => {
    expect(countTests('const a = "x"; /* it("b", () => {}); */ it("c", () => {});')).toBe(1);
  });

  it("文字列の中の URL の後にあるテストを残すこと", () => {
    expect(countTests('const url = "https://example.com"; it("a", () => {});')).toBe(1);
  });
});

describe("finding", () => {
  const two = 'it("a", () => {});\nit("b", () => {});\n';
  const one = 'it("a", () => {});\n';

  it("削除されたテストファイルを報告すること", () => {
    expect(finding({ from: "a.test.ts", to: undefined }, "", "")).toEqual({
      kind: "deleted",
      path: "a.test.ts",
    });
  });

  it("新しい名前でテストケースが減ったことを報告すること", () => {
    expect(finding({ from: "old.test.ts", to: "new.test.ts" }, two, one)).toEqual({
      kind: "fewer",
      path: "new.test.ts",
      before: 2,
      after: 1,
    });
  });

  it("数が変わらない、または増えるとき、何も報告しないこと", () => {
    expect(finding({ from: "a.test.ts", to: "a.test.ts" }, two, two)).toBeUndefined();
    expect(finding({ from: "a.test.ts", to: "a.test.ts" }, one, two)).toBeUndefined();
  });
});

describe("findingLines", () => {
  it("指摘を 1 回ずつ、並べ替えて述べること", () => {
    expect(
      findingLines([
        { kind: "fewer", path: "b.test.ts", before: 3, after: 1 },
        { kind: "deleted", path: "a.test.ts" },
        { kind: "deleted", path: "a.test.ts" },
      ]),
    ).toEqual(["a.test.ts (deleted)", "b.test.ts (3 -> 1 test cases)"]);
  });

  it("何も見つからなかったとき、何も述べないこと", () => {
    expect(findingLines([])).toEqual([]);
  });
});

describe("warning", () => {
  const found = ["a.test.ts (deleted)", "b.test.ts (3 -> 1 test cases)"];

  it("GitHub Actions の外では、指摘、すべきこと、抑え方を stderr に出力すること", () => {
    expect(warning(found, {})).toEqual({
      stdout: "",
      stderr: [
        "test-weakening: warning: this change deletes test files or declares fewer test cases than before:",
        "  - a.test.ts (deleted)",
        "  - b.test.ts (3 -> 1 test cases)",
        `${fix} See ${guide}.`,
        "If the change is intended, silence the warning with TESTS_ACK=1 (for example: TESTS_ACK=1 git push).",
        "",
      ].join("\n"),
    });
  });

  it("GitHub Actions では、ファイルを挙げレビューの手引きへリンクする ::warning:: annotation を書くこと", () => {
    expect(warning(found, { GITHUB_ACTIONS: "true" })).toEqual({
      stdout: [
        "This change deletes test files or declares fewer test cases than before:",
        "  - a.test.ts (deleted)",
        "  - b.test.ts (3 -> 1 test cases)",
        fix,
        `What a reviewer checks: ${guideUrl}`,
        `::warning title=test-weakening::Deleted test files or fewer test cases: a.test.ts (deleted), b.test.ts (3 -> 1 test cases). ${fix} What a reviewer checks: ${guideUrl}`,
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("workflow を実行するリポジトリへリンクすること", () => {
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_SERVER_URL: "https://ghe.example.com",
      GITHUB_REPOSITORY: "org/fork",
    };
    expect(warning(found, env).stdout).toContain(
      "https://ghe.example.com/org/fork/blob/main/docs/code-review/agent-pull-requests.md#人が判断するもの",
    );
  });

  it("annotation を終わらせる文字と壊す文字をエスケープすること", () => {
    const { stdout } = warning(["100%.test.ts (deleted)", "a\r\nb.test.ts (deleted)"], {
      GITHUB_ACTIONS: "true",
    });
    expect(stdout).toContain("cases: 100%25.test.ts (deleted), a%0D%0Ab.test.ts (deleted).");
  });
});

describe("skipped", () => {
  it("GitHub Actions の外では、理由を stderr に出力すること", () => {
    expect(skipped("No base.", {})).toEqual({
      stdout: "",
      stderr: "test-weakening: skipped. No base.\n",
    });
  });

  it("GitHub Actions では ::notice:: にすること", () => {
    expect(skipped("No base.\nMore.", { GITHUB_ACTIONS: "true" })).toEqual({
      stdout: "::notice title=test-weakening::skipped. No base.%0AMore.\n",
      stderr: "",
    });
  });
});
