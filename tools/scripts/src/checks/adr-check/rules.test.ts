import { describe, expect, it } from "vite-plus/test";
import { isDecisionPath, skipped, warnedPaths, warning } from "./rules.ts";

const guide = 'docs/knowledge/documentation-authoring.md ("ADR を書くかどうか")';
const guideUrl =
  "https://github.com/yokozi-jp/agent-software-factory/blob/main/docs/knowledge/documentation-authoring.md#adr-を書くかどうか";

describe("warning", () => {
  it("GitHub Actions の外では、ファイル、基準、抑え方を stderr に出力すること", () => {
    expect(warning(["mise.toml", "package.json"], {})).toEqual({
      stdout: "",
      stderr: [
        "adr-check: warning: this change touches files that often record a decision, and adds no ADR (docs/adr/NNNN-*.md):",
        "  - mise.toml",
        "  - package.json",
        `Write an ADR if the decision is hard to reverse, surprising without context, and a real trade-off. See ${guide}.`,
        "If this change needs no ADR, silence the warning with ADR_ACK=1 (for example: ADR_ACK=1 git push).",
        "",
      ].join("\n"),
    });
  });

  it("GitHub Actions では、ファイルを挙げ基準へのリンクを付けた ::warning:: annotation を書くこと", () => {
    expect(warning(["mise.toml", "package.json"], { GITHUB_ACTIONS: "true" })).toEqual({
      stdout: [
        "This change touches files that often record a decision, and adds no ADR (docs/adr/NNNN-*.md):",
        "  - mise.toml",
        "  - package.json",
        `Whether to write an ADR: ${guideUrl}`,
        `::warning title=adr-check::Changed files that often record a decision, with no ADR added: mise.toml, package.json. Whether to write an ADR: ${guideUrl}`,
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
    expect(warning(["nx.json"], env).stdout).toContain(
      "https://ghe.example.com/org/fork/blob/main/docs/knowledge/documentation-authoring.md#adr-を書くかどうか",
    );
  });

  it("annotation を終わらせる文字と壊す文字をエスケープすること", () => {
    const { stdout } = warning(["apps/100%/package.json", "a\r\nb/package.json"], {
      GITHUB_ACTIONS: "true",
    });
    expect(stdout).toContain("added: apps/100%25/package.json, a%0D%0Ab/package.json.");
  });
});

describe("skipped", () => {
  it("GitHub Actions の外では、理由を stderr に出力すること", () => {
    expect(skipped("No base.", {})).toEqual({
      stdout: "",
      stderr: "adr-check: skipped. No base.\n",
    });
  });

  it("GitHub Actions では ::notice:: にすること", () => {
    expect(skipped("No base.", { GITHUB_ACTIONS: "true" })).toEqual({
      stdout: "::notice title=adr-check::skipped. No base.\n",
      stderr: "",
    });
  });
});

describe("warnedPaths", () => {
  // Each argument is the `git diff --name-status --no-renames` output of one pushed commit.
  it("commit が変える判断のファイルを一覧にすること", () => {
    expect(warnedPaths(["M\tpackage.json\nM\tREADME.md\nA\t.github/workflows/new.yml\n"])).toEqual([
      ".github/workflows/new.yml",
      "package.json",
    ]);
  });

  it("判断のファイルが変わらないとき、何も一覧にしないこと", () => {
    expect(warnedPaths(["M\tREADME.md\nM\tapps/web/src/index.ts\n"])).toEqual([]);
  });

  it("commit が ADR を足すとき、何も一覧にしないこと", () => {
    expect(warnedPaths(["M\tpackage.json\nA\tdocs/adr/0002-new.md\n"])).toEqual([]);
  });

  it("commit が ADR を編集または削除するだけのときは、警告すること", () => {
    expect(
      warnedPaths(["M\tpackage.json\nM\tdocs/adr/0001-a.md\nD\tdocs/adr/0003-b.md\n"]),
    ).toEqual(["package.json"]);
  });

  it.each([
    "docs/adr/index.md",
    "docs/adr/12-x.md",
    "apps/docs/adr/0002-x.md",
    "docs/adr/0002-x.md.orig",
  ])("%s を ADR に数えないこと", (path) => {
    expect(warnedPaths([`M\tpackage.json\nA\t${path}\n`])).toEqual(["package.json"]);
  });

  it("commit ごとに判断し、ある commit の ADR がほかの commit を覆わないこと", () => {
    const withAdr = "M\tnx.json\nA\tdocs/adr/0002-new.md\n";
    const withoutAdr = "M\tpackage.json\n";
    expect(warnedPaths([withAdr, withoutAdr])).toEqual(["package.json"]);
  });

  it("2 つの commit が変えたファイルを 1 回だけ一覧にすること", () => {
    expect(warnedPaths(["M\tpackage.json\n", "M\tpackage.json\n"])).toEqual(["package.json"]);
  });
});

describe("isDecisionPath", () => {
  it.each([
    "package.json",
    "apps/api/package.json",
    "pnpm-workspace.yaml",
    "mise.toml",
    "nx.json",
    "lefthook.yml",
    "vite.config.ts",
    "apps/api/vite.config.ts",
    "commitlint.config.ts",
    ".node-version",
    ".betterleaks.toml",
    ".jscpd.json",
    ".markdownlint-cli2.yaml",
    ".github/workflows/ci.yml",
    ".github/rulesets/protect-main.json",
    ".kiro/hooks/x.sh",
    ".kiro/settings/mcp.json",
  ])("%s を判断を記録することの多いファイルに数えること", (path) => {
    expect(isDecisionPath(path)).toBe(true);
  });

  it.each([
    "README.md",
    "apps/web/src/index.ts",
    "pnpm-lock.yaml",
    "mise.lock",
    "docs/adr/0001-a.md",
    ".github/CODEOWNERS",
    "tools/scripts/src/checks/adr-check/rules.ts",
  ])("%s を数えないこと", (path) => {
    expect(isDecisionPath(path)).toBe(false);
  });

  it.each([
    "fixtures/package.json",
    "test/vite.config.ts",
    "tests/package.json",
    "__tests__/package.json",
    "__fixtures__/package.json",
    "scripts/test/fixtures/package.json",
    "apps/api/fixtures/package.json",
    "apps/api/__fixtures__/vite.config.ts",
    "scripts/test/lefthook.yml",
    "apps/api/tests/package.json",
    "apps/api/__tests__/package.json",
    "apps/api/vite.config.test.ts",
    "apps/api/package.spec.json",
  ])("名前が合っていても、テストや fixture である %s を数えないこと", (path) => {
    expect(isDecisionPath(path)).toBe(false);
  });
});
