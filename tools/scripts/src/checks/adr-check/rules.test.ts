import { describe, expect, it } from "vite-plus/test";
import { isDecisionPath, skipped, warnedPaths, warning } from "./rules.ts";

const guide = 'docs/knowledge/documentation-authoring.md ("ADR を書くかどうか")';
const guideUrl =
  "https://github.com/yokozi-jp/agent-software-factory/blob/main/docs/knowledge/documentation-authoring.md#adr-を書くかどうか";

describe("warning", () => {
  it("prints the files, the criteria and how to silence it on stderr, outside GitHub Actions", () => {
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

  it("writes a ::warning:: annotation that names the files and links to the criteria in GitHub Actions", () => {
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

  it("links to the repository that runs the workflow", () => {
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_SERVER_URL: "https://ghe.example.com",
      GITHUB_REPOSITORY: "org/fork",
    };
    expect(warning(["nx.json"], env).stdout).toContain(
      "https://ghe.example.com/org/fork/blob/main/docs/knowledge/documentation-authoring.md#adr-を書くかどうか",
    );
  });

  it("escapes the characters that end or break an annotation", () => {
    const { stdout } = warning(["apps/100%/package.json", "a\r\nb/package.json"], {
      GITHUB_ACTIONS: "true",
    });
    expect(stdout).toContain("added: apps/100%25/package.json, a%0D%0Ab/package.json.");
  });
});

describe("skipped", () => {
  it("says why on stderr, outside GitHub Actions", () => {
    expect(skipped("No base.", {})).toEqual({
      stdout: "",
      stderr: "adr-check: skipped. No base.\n",
    });
  });

  it("is a ::notice:: in GitHub Actions", () => {
    expect(skipped("No base.", { GITHUB_ACTIONS: "true" })).toEqual({
      stdout: "::notice title=adr-check::skipped. No base.\n",
      stderr: "",
    });
  });
});

describe("warnedPaths", () => {
  // Each argument is the `git diff --name-status --no-renames` output of one pushed commit.
  it("lists the decision files that a commit changes", () => {
    expect(warnedPaths(["M\tpackage.json\nM\tREADME.md\nA\t.github/workflows/new.yml\n"])).toEqual([
      ".github/workflows/new.yml",
      "package.json",
    ]);
  });

  it("lists nothing when no decision file changed", () => {
    expect(warnedPaths(["M\tREADME.md\nM\tapps/web/src/index.ts\n"])).toEqual([]);
  });

  it("lists nothing when the commit adds an ADR", () => {
    expect(warnedPaths(["M\tpackage.json\nA\tdocs/adr/0002-new.md\n"])).toEqual([]);
  });

  it("still warns when the commit only edits or deletes an ADR", () => {
    expect(
      warnedPaths(["M\tpackage.json\nM\tdocs/adr/0001-a.md\nD\tdocs/adr/0003-b.md\n"]),
    ).toEqual(["package.json"]);
  });

  it.each([
    "docs/adr/index.md",
    "docs/adr/12-x.md",
    "apps/docs/adr/0002-x.md",
    "docs/adr/0002-x.md.orig",
  ])("does not count %s as an ADR", (path) => {
    expect(warnedPaths([`M\tpackage.json\nA\t${path}\n`])).toEqual(["package.json"]);
  });

  it("judges each commit on its own: an ADR on one does not cover another", () => {
    const withAdr = "M\tnx.json\nA\tdocs/adr/0002-new.md\n";
    const withoutAdr = "M\tpackage.json\n";
    expect(warnedPaths([withAdr, withoutAdr])).toEqual(["package.json"]);
  });

  it("lists a file changed by two commits once", () => {
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
  ])("counts %s as a file that often records a decision", (path) => {
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
  ])("does not count %s", (path) => {
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
  ])("does not count %s, a test or fixture, even when its name matches", (path) => {
    expect(isDecisionPath(path)).toBe(false);
  });
});
