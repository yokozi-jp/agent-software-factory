// The checks of references to docs/ and to the code
// (./docs-references.ts), each called alone on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { passingRepo } from "./fixtures/passing-repo.ts";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { docsCodePaths, docsReferences } from "./docs-references.ts";

const base = passingRepo;

describe("references to docs/ from outside docs/", () => {
  const violations = failuresOf(docsReferences);
  const cite = (line: string, path = "lefthook.yml") => ({
    [path]: `${base["lefthook.yml"] ?? ""}# ${line}\n`,
  });

  it.each([
    ["a file", "see docs/local-env-setup/setup.md"],
    [
      "a heading without its number",
      'see docs/local-env-setup/setup.md ("Ubuntu の初期セットアップ")',
    ],
    [
      "a heading with its number",
      'see docs/local-env-setup/setup.md ("3. Ubuntu の初期セットアップ")',
    ],
    [
      "a heading in a JSON string",
      'see docs/local-env-setup/setup.md (\\"Ubuntu の初期セットアップ\\")',
    ],
    ["an ADR number", "(docs/adr/0002)"],
    ["an ADR file", "docs/adr/0002-nx.md"],
    ["an ADR number at the end of a line", "docs/adr/0002"],
    ["a path inside another path", "see apps/docs/missing.md and ../docs/missing.md"],
    ["an ADR number with more digits", "docs/adr/99999"],
  ])("passes %s that exists", (_, line) => {
    expect(violations(repo(cite(line)))).toEqual([]);
  });

  it("refuses a file that does not exist", () => {
    expect(violations(repo(cite("see docs/tooling/missing.md")))).toEqual([
      "lefthook.yml cites docs/tooling/missing.md, which does not exist.",
    ]);
  });

  it("refuses a heading that does not exist", () => {
    expect(violations(repo(cite('see docs/local-env-setup/setup.md ("No such heading")')))).toEqual(
      [
        'lefthook.yml cites the heading "No such heading" in docs/local-env-setup/setup.md, which has no such heading.',
      ],
    );
  });

  it("matches the whole heading line, not a part of it", () => {
    expect(violations(repo(cite('docs/local-env-setup/setup.md ("Ubuntu")')))).toEqual([
      'lefthook.yml cites the heading "Ubuntu" in docs/local-env-setup/setup.md, which has no such heading.',
    ]);
  });

  it("refuses an ADR number that does not exist", () => {
    expect(violations(repo(cite("docs/adr/9999")))).toEqual([
      "lefthook.yml cites docs/adr/9999, which does not exist.",
    ]);
  });

  it("names every reference of a line", () => {
    expect(violations(repo(cite("docs/adr/9998 and docs/adr/9999.")))).toEqual([
      "lefthook.yml cites docs/adr/9998, which does not exist.",
      "lefthook.yml cites docs/adr/9999, which does not exist.",
    ]);
  });

  it("checks the code and the tests of tools/scripts", () => {
    expect(
      violations(
        repo({
          "tools/scripts/src/checks/other.ts": "// docs/tooling/missing.md\n",
          "tools/scripts/src/checks/other.test.ts": "// docs/adr/9999\n",
        }),
      ),
    ).toEqual([
      "tools/scripts/src/checks/other.test.ts cites docs/adr/9999, which does not exist.",
      "tools/scripts/src/checks/other.ts cites docs/tooling/missing.md, which does not exist.",
    ]);
  });

  it.each([
    "docs/tooling/a.md",
    ".agents/skills/a/SKILL.md",
    ".kiro/skills/a/SKILL.md",
    "research/a.md",
    "tools/scripts/src/checks/adr-check/rules.test.ts",
    "tools/scripts/src/checks/repo-policy/rules.test.ts",
    "tools/scripts/src/checks/repo-policy/fixtures/passing-repo.ts",
    "pnpm-lock.yaml",
  ])("does not check %s, which may cite missing docs on purpose", (path) => {
    expect(violations(repo({ [path]: "docs/adr/9999\n" }))).toEqual([]);
  });

  it("checks a path that only has research/ inside it", () => {
    expect(violations(repo({ "apps/research/a.md": "docs/adr/9999\n" }))).toEqual([
      "apps/research/a.md cites docs/adr/9999, which does not exist.",
    ]);
  });

  it("does not read binary files", () => {
    expect(violations(repo({ "assets/a.png": "\0docs/adr/9999\n" }))).toEqual([]);
  });

  it("counts a doc only if the tree has it", () => {
    expect(
      violations(
        repo({
          "docs/local-env-setup/setup.md": undefined,
          ...cite("docs/local-env-setup/setup.md"),
        }),
      ),
    ).toEqual(["lefthook.yml cites docs/local-env-setup/setup.md, which does not exist."]);
  });
});

describe("references from docs/ to files of the code", () => {
  const violations = failuresOf(docsCodePaths);
  const cite = (line: string, path = "docs/tooling/ci.md") => ({
    [path]: `# A doc\n\n${line}\n`,
  });
  const missing = (path: string, source = "docs/tooling/ci.md") =>
    `${source} cites ${path}, which does not exist. The file was moved or removed: write its path now, or the directory it is in.`;

  it.each([
    ["a path", "`tools/a.ts`", ["tools/a.ts"]],
    ["two paths", "`apps/a.json` and `packages/b/c.d.ts`", ["apps/a.json", "packages/b/c.d.ts"]],
    ["a path in a dot directory", "`.github/a/b.txt`", [".github/a/b.txt"]],
    ["a Kiro file", "`.kiro/a-b.txt`", [".kiro/a-b.txt"]],
    ["a type file", "`types/a.d.ts`", ["types/a.d.ts"]],
    ["a path in a sentence", "see `tools/a_b/@c.ts` for it", ["tools/a_b/@c.ts"]],
  ])("passes %s that exists", (_, line, exists) => {
    expect(
      violations(repo({ ...cite(line), ...Object.fromEntries(exists.map((path) => [path, ""])) })),
    ).toEqual([]);
  });

  it.each([
    ["tools/scripts/src/checks/repo-policy/missing.ts"],
    [".github/workflows/missing.yml"],
    [".kiro/hooks/missing.json"],
    ["tools/scripts/src/checks/repo-policy/cli.ts.map"],
    ["packages/module-fixtures/src/missing.ts"],
    ["apps/api/missing.json"],
    ["types/missing.d.ts"],
    ["tools/scripts/src/a-b_c.d/@x.ts"],
  ])("refuses `%s`, which does not exist", (path) => {
    expect(violations(repo(cite(`\`${path}\``)))).toEqual([missing(path)]);
  });

  it("names each citing doc, and each path once per citation", () => {
    expect(
      violations(
        repo({
          ...cite("`tools/a.ts` and `tools/b.ts`", "docs/a.md"),
          ...cite("`tools/a.ts`", "docs/tooling/b.md"),
        }),
      ),
    ).toEqual([
      missing("tools/a.ts", "docs/a.md"),
      missing("tools/b.ts", "docs/a.md"),
      missing("tools/a.ts", "docs/tooling/b.md"),
    ]);
  });

  it.each([
    ["a directory", "`tools/scripts/src/`"],
    ["a directory without a slash", "`tools/scripts`"],
    ["a glob", "`packages/*/src/index.ts`"],
    ["a placeholder", "`packages/<module>/src/index.ts`"],
    ["a path with a line number", "`tools/scripts/src/a.ts:12`"],
    ["a path in plain text", "see tools/scripts/src/a.ts"],
    ["a path under another top-level directory", "`scripts/a.sh` and `research/a.md`"],
    ["a code span of several words", "`node tools/a.ts`"],
  ])("skips %s", (_, line) => {
    expect(violations(repo(cite(line)))).toEqual([]);
  });

  it("checks the ADRs too", () => {
    expect(violations(repo(cite("`tools/a.ts`", "docs/adr/0002-nx.md")))).toEqual([
      missing("tools/a.ts", "docs/adr/0002-nx.md"),
    ]);
  });

  it("skips a file that is not Markdown, and a file outside docs/", () => {
    expect(
      violations(
        repo({
          ...cite("`tools/a.ts`", "docs/tooling/a.txt"),
          ...cite("`tools/a.ts`", "README.md"),
        }),
      ),
    ).toEqual([]);
  });
});

describe("references to docs/: the edges", () => {
  const violations = failuresOf(docsReferences);
  const withSetup = (setup: string, line: string) => ({
    "docs/local-env-setup/setup.md": setup,
    "lefthook.yml": `${base["lefthook.yml"] ?? ""}# ${line}\n`,
  });

  it.each([
    "apps/docs/a.md",
    "apps/.agents/a.sh",
    "apps/.kiro/skills/a.md",
    "apps/tools/scripts/src/checks/adr-check/a.test.ts",
    "tools/scripts/src/checks/adr-check/a.test.ts.bak",
    "apps/pnpm-lock.yaml",
    "pnpm-lock.yaml.bak",
  ])("checks %s", (path) => {
    expect(violations(repo({ [path]: "docs/adr/9999\n" }))).toEqual([
      `${path} cites docs/adr/9999, which does not exist.`,
    ]);
  });

  it("passes a heading with a number of two digits", () => {
    const files = withSetup(
      "# Setup\n\n## 10. Ubuntu の初期セットアップ\n",
      'docs/local-env-setup/setup.md ("Ubuntu の初期セットアップ")',
    );
    expect(violations(repo(files))).toEqual([]);
  });

  it.each([
    ["a number inside the heading", "## Node 24. Ubuntu", "Node Ubuntu"],
    ["text that is not a heading", "see # Ubuntu", "Ubuntu"],
  ])("does not drop %s", (_, line, heading) => {
    const files = withSetup(`# Setup\n\n${line}\n`, `docs/local-env-setup/setup.md ("${heading}")`);
    expect(violations(repo(files))).toEqual([
      `lefthook.yml cites the heading "${heading}" in docs/local-env-setup/setup.md, which has no such heading.`,
    ]);
  });

  it("passes a file cited without a heading, whatever it holds", () => {
    expect(violations(repo(withSetup("# Setup", "docs/local-env-setup/setup.md")))).toEqual([]);
  });

  it("does not count a file of another type as an ADR", () => {
    const files = {
      "docs/adr/0003-notes.txt": "x\n",
      "lefthook.yml": `${base["lefthook.yml"] ?? ""}# docs/adr/0003\n`,
    };
    expect(violations(repo(files))).toEqual([
      "lefthook.yml cites docs/adr/0003, which does not exist.",
    ]);
  });
});
