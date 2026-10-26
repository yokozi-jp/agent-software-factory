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
  ])("counts %s as a test file", (path) => {
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
  ])("does not count %s", (path) => {
    expect(isTestFile(path)).toBe(false);
  });

  it("counts a directory whose name only contains fixtures", () => {
    expect(isTestFile("my-fixtures/a.test.ts")).toBe(true);
    expect(isTestFile("fixtures-old/a.test.ts")).toBe(true);
  });
});

describe("testChanges", () => {
  // The argument is the `git diff --name-status --find-renames` output from the merge base to one commit.
  it("keeps the deleted, modified and renamed test files, in order", () => {
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

  it("treats a test file renamed to a file that is not a test as deleted", () => {
    expect(testChanges("R100\ta.test.ts\tfixtures/a.test.ts\n")).toEqual([
      { from: "a.test.ts", to: undefined },
    ]);
  });

  it("leaves out added test files and files that are not tests", () => {
    const diff = "A\tnew.test.ts\nM\tsrc/app.ts\nD\tsrc/old.ts\nR100\tsrc/x.ts\tsrc/x.test.ts\n";
    expect(testChanges(diff)).toEqual([]);
  });

  it("reads nothing from empty input", () => {
    expect(testChanges("")).toEqual([]);
  });

  it("reads only whole lines of the form git prints", () => {
    const diff = ["xM\ta.test.ts", "M a.test.ts", "Ma\tb.test.ts", "R1\tc.test.ts\td.test.ts\te"];
    expect(testChanges(diff.join("\n"))).toEqual([]);
  });

  it("keeps paths with spaces and non-ASCII names", () => {
    expect(testChanges("M\tsrc/ログイン の.test.ts\n")).toEqual([
      { from: "src/ログイン の.test.ts", to: "src/ログイン の.test.ts" },
    ]);
  });
});

describe("countTests", () => {
  it("counts it and test calls", () => {
    expect(countTests('it("a", () => {});\ntest("b", () => {});\n')).toBe(2);
  });

  it("counts nothing in a file with no tests", () => {
    expect(countTests('describe("a", () => {});\nconst x = 1;\n')).toBe(0);
  });

  it("counts a table once", () => {
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
  ])("counts %s as a test that runs", (call) => {
    expect(countTests(`${call}("a", () => {});`)).toBe(1);
  });

  it.each(["it.skip", "test.todo", "it.concurrent.skip", "test.extend({})", "test.scoped({})"])(
    "does not count %s",
    (call) => {
      expect(countTests(`${call}("a", () => {});`)).toBe(0);
    },
  );

  it("does not count methods or properties named it or test", () => {
    expect(
      countTests('if (/x/.test(path)) items.it("a");\nconst $test = 1; mytest("b"); _it("c");'),
    ).toBe(0);
  });

  it("does not count a call with a space before the parenthesis", () => {
    expect(countTests('it ("a", () => {});')).toBe(0);
  });

  it("leaves out line and block comments", () => {
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

  it("removes a comment instead of blanking it, so a method call stays a method call", () => {
    expect(countTests('items./* note */it("a", () => {});')).toBe(0);
  });

  it("keeps a test after a URL in a string", () => {
    expect(countTests('const url = "https://example.com"; it("a", () => {});')).toBe(1);
  });
});

describe("finding", () => {
  const two = 'it("a", () => {});\nit("b", () => {});\n';
  const one = 'it("a", () => {});\n';

  it("reports a deleted test file", () => {
    expect(finding({ from: "a.test.ts", to: undefined }, "", "")).toEqual({
      kind: "deleted",
      path: "a.test.ts",
    });
  });

  it("reports fewer test cases under the new name", () => {
    expect(finding({ from: "old.test.ts", to: "new.test.ts" }, two, one)).toEqual({
      kind: "fewer",
      path: "new.test.ts",
      before: 2,
      after: 1,
    });
  });

  it("reports nothing when the number stays the same or grows", () => {
    expect(finding({ from: "a.test.ts", to: "a.test.ts" }, two, two)).toBeUndefined();
    expect(finding({ from: "a.test.ts", to: "a.test.ts" }, one, two)).toBeUndefined();
  });
});

describe("findingLines", () => {
  it("describes each finding once, sorted", () => {
    expect(
      findingLines([
        { kind: "fewer", path: "b.test.ts", before: 3, after: 1 },
        { kind: "deleted", path: "a.test.ts" },
        { kind: "deleted", path: "a.test.ts" },
      ]),
    ).toEqual(["a.test.ts (deleted)", "b.test.ts (3 -> 1 test cases)"]);
  });

  it("describes nothing when nothing was found", () => {
    expect(findingLines([])).toEqual([]);
  });
});

describe("warning", () => {
  const found = ["a.test.ts (deleted)", "b.test.ts (3 -> 1 test cases)"];

  it("prints the findings, what to do and how to silence it on stderr, outside GitHub Actions", () => {
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

  it("writes a ::warning:: annotation that names the files and links to the review guide in GitHub Actions", () => {
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

  it("links to the repository that runs the workflow", () => {
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_SERVER_URL: "https://ghe.example.com",
      GITHUB_REPOSITORY: "org/fork",
    };
    expect(warning(found, env).stdout).toContain(
      "https://ghe.example.com/org/fork/blob/main/docs/code-review/agent-pull-requests.md#人が判断するもの",
    );
  });

  it("escapes the characters that end or break an annotation", () => {
    const { stdout } = warning(["100%.test.ts (deleted)", "a\r\nb.test.ts (deleted)"], {
      GITHUB_ACTIONS: "true",
    });
    expect(stdout).toContain("cases: 100%25.test.ts (deleted), a%0D%0Ab.test.ts (deleted).");
  });
});

describe("skipped", () => {
  it("says why on stderr, outside GitHub Actions", () => {
    expect(skipped("No base.", {})).toEqual({
      stdout: "",
      stderr: "test-weakening: skipped. No base.\n",
    });
  });

  it("is a ::notice:: in GitHub Actions", () => {
    expect(skipped("No base.\nMore.", { GITHUB_ACTIONS: "true" })).toEqual({
      stdout: "::notice title=test-weakening::skipped. No base.%0AMore.\n",
      stderr: "",
    });
  });
});
