// The checks of references to docs/ and to the code
// (./docs-references.ts), each called alone on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { passingRepo } from "./fixtures/passing-repo.ts";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { codePathReferences, docsReferences } from "./docs-references.ts";

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
  const violations = failuresOf(codePathReferences);
  const cite = (line: string, path = "docs/tooling/ci.md") => ({
    [path]: `# A doc\n\n${line}\n`,
  });
  const missing = (path: string, source = "docs/tooling/ci.md") =>
    `${source} names ${path}, which does not exist. The file was moved or removed: write its path now, or the directory it is in.`;

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
    ["packages/claim/src/missing.d.ts"],
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
    [
      "an upstream repository path",
      "`<upstream>/.github/workflows/ci.yml` and `owner/repo/.github/ISSUE_TEMPLATE/idea.yml`",
    ],
  ])("skips %s", (_, line) => {
    expect(violations(repo(cite(line)))).toEqual([]);
  });

  it("reads every top-level directory of the tree, as the configs do", () => {
    expect(violations(repo({ ...cite("`docker/missing.yml`"), "docker/a.yml": "" }))).toEqual([
      missing("docker/missing.yml"),
    ]);
  });

  it("checks the ADRs too", () => {
    expect(violations(repo(cite("`tools/a.ts`", "docs/adr/0002-nx.md")))).toEqual([
      missing("tools/a.ts", "docs/adr/0002-nx.md"),
    ]);
  });

  it("skips a file under docs/ that is not Markdown", () => {
    expect(
      violations(
        repo({
          ...cite("`tools/a.ts`", "docs/tooling/a.txt"),
          ...cite("`tools/a.ts`", "docs/tooling/a.md.txt"),
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

describe("references from the configs and the scripts to files of the code", () => {
  const violations = failuresOf(codePathReferences);
  const cite = (line: string, path = "lefthook.yml") => ({ [path]: `${line}\n` });
  const missing = (path: string, source = "lefthook.yml") =>
    `${source} names ${path}, which does not exist. The file was moved or removed: write its path now, or the directory it is in.`;

  it.each([
    ["a path", '- "packages/a/b.ts"', ["packages/a/b.ts"]],
    ["a path in a comment", "# see tools/a/b.ts for it", ["tools/a/b.ts"]],
    ["a path that ends a sentence", "# it is in apps/a/b.ts.", ["apps/a/b.ts"]],
    ["a path with a line number", "# tools/a.ts:12", ["tools/a.ts"]],
    ["a path in a dot directory", "# .github/workflows/a.yml", [".github/workflows/a.yml"]],
    ["a path in single quotes", "const p = 'packages/a/b.ts';", ["packages/a/b.ts"]],
  ])("passes %s that exists", (_, line, exists) => {
    expect(
      violations(repo({ ...cite(line), ...Object.fromEntries(exists.map((path) => [path, ""])) })),
    ).toEqual([]);
  });

  it.each([
    ["a glob", '- "packages/*/src/a.ts"'],
    ["a glob of a directory", '- "packages/db/migrations/**"'],
    ["a placeholder", "# packages/<name>/package.json"],
    ["a root alone", "# packages/ and apps/"],
    ["a glob after a directory", "# apps/web/src/**/x.ts and packages/*/src/x.ts"],
    ["a glob of braces", "# {apps,packages}/*/src/x.ts"],
    ["a name with no extension", "# packages/a/src and tools/scripts"],
    ["a path inside a longer path", "# https://example.com/apps/a/b.ts"],
    [
      "an upstream repository path",
      "# <upstream>/.github/workflows/ci.yml and owner/repo/.github/ISSUE_TEMPLATE/idea.yml",
    ],
    ["a name that is not under a directory of the code", "# docs/a.ts and src/a.ts"],
    // The limits in docs/tooling/ci.md: none of these is read.
    ["a path from its package", '"entry": "src/seed/index.ts"'],
    ["a path with escaped slashes in JSON", '"entry": "packages\\/a\\/b.ts"'],
    [
      "an untracked output outside the roots",
      "# coverage/coverage-final.json and .nx/cache/a.json",
    ],
    ["an untracked output under a root, as a glob", '- "apps/api/dist/**"'],
  ])("does not read %s as a file the tree must have", (_, line) => {
    expect(violations(repo(cite(line)))).toEqual([]);
  });

  it("reads a directory with a slash, which must have a file of the tree under it", () => {
    expect(violations(repo({ ...cite("# packages/a/src/"), "packages/a/src/x.ts": "" }))).toEqual(
      [],
    );
    expect(violations(repo(cite("# packages/a/src/ and packages/b/")))).toEqual([
      missing("packages/a/src/"),
      missing("packages/b/"),
    ]);
  });

  it("resolves a relative path from the directory of the file that names it", () => {
    const named = cite('import("../../../apps/c.ts") and "./packages/d.ts"', "packages/x/y/z.ts");
    expect(
      violations(repo({ ...named, "apps/c.ts": "", "packages/x/y/packages/d.ts": "" })),
    ).toEqual([]);
    expect(violations(repo(named))).toEqual([
      missing("../../../apps/c.ts", "packages/x/y/z.ts"),
      missing("./packages/d.ts", "packages/x/y/z.ts"),
    ]);
  });

  it("takes the top-level directories from the tree, so a directory of its own is read too", () => {
    expect(violations(repo({ ...cite("# docker/a/b.sh"), "docker/c.txt": "" }))).toEqual([
      missing("docker/a/b.sh"),
    ]);
    expect(violations(repo(cite("# docker/a/b.sh")))).toEqual([]);
  });

  it("refuses a path that does not exist, in a config, a workflow and a script", () => {
    expect(
      violations(
        repo({
          ...cite("# packages/a/missing.ts"),
          ...cite("run: node tools/b/missing.js", ".github/workflows/ci.yml"),
          ...cite('export const entry = "apps/c/missing.ts";', "tools/scripts/src/checks/x.ts"),
        }),
      ),
    ).toEqual([
      missing("tools/b/missing.js", ".github/workflows/ci.yml"),
      missing("packages/a/missing.ts"),
      missing("apps/c/missing.ts", "tools/scripts/src/checks/x.ts"),
    ]);
  });

  it("names a path once for a file, and every path of a line", () => {
    expect(violations(repo(cite("# apps/a/x.ts apps/a/x.ts packages/b/y.ts")))).toEqual([
      missing("apps/a/x.ts"),
      missing("packages/b/y.ts"),
    ]);
  });

  it("refuses a path in Markdown outside docs/ too", () => {
    expect(
      violations(
        repo({
          ...cite("See `tools/a/missing.ts`.", "AGENTS.md"),
          ...cite("See tools/b/missing.ts.", "apps/docs/README.md"),
        }),
      ),
    ).toEqual([
      missing("tools/a/missing.ts", "AGENTS.md"),
      missing("tools/b/missing.ts", "apps/docs/README.md"),
    ]);
  });

  it.each([
    "docs/tooling/a.md",
    ".agents/skills/a/SKILL.md",
    ".kiro/skills/a/SKILL.md",
    "research/a.md",
    "pnpm-lock.yaml",
    "mise.lock",
    "packages/a/CHANGELOG.md",
    "tools/scripts/src/checks/a.test.ts",
    "apps/web/src/a.test.tsx",
    "tools/scripts/src/checks/repo-policy/fixtures/passing-repo.ts",
    "packages/a/src/__fixtures__/b.ts",
    "packages/a/src/db.gen.ts",
    ".gitignore",
    "apps/web/.prettierignore",
  ])("does not check %s, which may name a missing file on purpose", (path) => {
    expect(violations(repo({ [path]: "apps/a/missing.ts\n" }))).toEqual([]);
  });

  it("does not read binary files", () => {
    expect(violations(repo({ "assets/a.png": "\0apps/a/missing.ts\n" }))).toEqual([]);
  });

  it("reads nothing in a tree that has no directory", () => {
    const flat = {
      tracked: new Map([["a.md", "100644"]]),
      untrackedSteering: [],
      viteHooks: false,
    };
    expect(violations({ ...flat, read: () => "apps/a/missing.ts\n" })).toEqual([]);
  });
});
