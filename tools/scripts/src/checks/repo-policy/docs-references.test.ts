// The checks of references to docs/ and to the code
// (./docs-references.ts), each called alone on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { passingRepo } from "./fixtures/passing-repo.ts";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { codePathReferences, docsReferences } from "./docs-references.ts";

const base = passingRepo;

// Said after a docs/ path or ADR number that the tree does not have.
const stagingHint = " A new file counts once it is staged (git add).";

describe("docs/ の外から docs/ への参照", () => {
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
  ])("存在する %s を通すこと", (_, line) => {
    expect(violations(repo(cite(line)))).toEqual([]);
  });

  it("存在しないファイルを拒否すること", () => {
    expect(violations(repo(cite("see docs/tooling/missing.md")))).toEqual([
      `lefthook.yml cites docs/tooling/missing.md, which does not exist.${stagingHint}`,
    ]);
  });

  it("存在しない見出しを拒否すること", () => {
    expect(violations(repo(cite('see docs/local-env-setup/setup.md ("No such heading")')))).toEqual(
      [
        'lefthook.yml cites the heading "No such heading" in docs/local-env-setup/setup.md, which has no such heading.',
      ],
    );
  });

  it("見出しの行の一部ではなく、全体に一致すること", () => {
    expect(violations(repo(cite('docs/local-env-setup/setup.md ("Ubuntu")')))).toEqual([
      'lefthook.yml cites the heading "Ubuntu" in docs/local-env-setup/setup.md, which has no such heading.',
    ]);
  });

  it("存在しない ADR 番号を拒否すること", () => {
    expect(violations(repo(cite("docs/adr/9999")))).toEqual([
      `lefthook.yml cites docs/adr/9999, which does not exist.${stagingHint}`,
    ]);
  });

  it("行のすべての参照を挙げること", () => {
    expect(violations(repo(cite("docs/adr/9998 and docs/adr/9999.")))).toEqual([
      `lefthook.yml cites docs/adr/9998, which does not exist.${stagingHint}`,
      `lefthook.yml cites docs/adr/9999, which does not exist.${stagingHint}`,
    ]);
  });

  it("tools/scripts のコードとテストを検査すること", () => {
    expect(
      violations(
        repo({
          "tools/scripts/src/checks/other.ts": "// docs/tooling/missing.md\n",
          "tools/scripts/src/checks/other.test.ts": "// docs/adr/9999\n",
        }),
      ),
    ).toEqual([
      `tools/scripts/src/checks/other.test.ts cites docs/adr/9999, which does not exist.${stagingHint}`,
      `tools/scripts/src/checks/other.ts cites docs/tooling/missing.md, which does not exist.${stagingHint}`,
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
  ])("わざと存在しない文書を引用してよい %s を検査しないこと", (path) => {
    expect(violations(repo({ [path]: "docs/adr/9999\n" }))).toEqual([]);
  });

  it("中に research/ があるだけの path を検査すること", () => {
    expect(violations(repo({ "apps/research/a.md": "docs/adr/9999\n" }))).toEqual([
      `apps/research/a.md cites docs/adr/9999, which does not exist.${stagingHint}`,
    ]);
  });

  it("バイナリファイルを読まないこと", () => {
    expect(violations(repo({ "assets/a.png": "\0docs/adr/9999\n" }))).toEqual([]);
  });

  it("ツリーにあるときだけ、文書を数えること", () => {
    expect(
      violations(
        repo({
          "docs/local-env-setup/setup.md": undefined,
          ...cite("docs/local-env-setup/setup.md"),
        }),
      ),
    ).toEqual([
      `lefthook.yml cites docs/local-env-setup/setup.md, which does not exist.${stagingHint}`,
    ]);
  });
});

describe("docs/ からコードのファイルへの参照", () => {
  const violations = failuresOf(codePathReferences);
  const cite = (line: string, path = "docs/tooling/ci.md") => ({
    [path]: `# A doc\n\n${line}\n`,
  });
  const missing = (path: string, source = "docs/tooling/ci.md") =>
    `${source} names ${path}, which does not exist. The file was moved or removed: write its path now, or the directory it is in.${stagingHint}`;

  it.each([
    ["a path", "`tools/a.ts`", ["tools/a.ts"]],
    ["two paths", "`apps/a.json` and `packages/b/c.d.ts`", ["apps/a.json", "packages/b/c.d.ts"]],
    ["a path in a dot directory", "`.github/a/b.txt`", [".github/a/b.txt"]],
    ["a Kiro file", "`.kiro/a-b.txt`", [".kiro/a-b.txt"]],
    ["a type file", "`types/a.d.ts`", ["types/a.d.ts"]],
    ["a path in a sentence", "see `tools/a_b/@c.ts` for it", ["tools/a_b/@c.ts"]],
  ])("存在する %s を通すこと", (_, line, exists) => {
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
  ])("存在しない `%s` を拒否すること", (path) => {
    expect(violations(repo(cite(`\`${path}\``)))).toEqual([missing(path)]);
  });

  it("引用する文書ごとに、引用ごとの path を 1 回ずつ挙げること", () => {
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
  ])("%s を読み飛ばすこと", (_, line) => {
    expect(violations(repo(cite(line)))).toEqual([]);
  });

  it("設定と同じく、ツリーのすべての最上位ディレクトリを読むこと", () => {
    expect(violations(repo({ ...cite("`docker/missing.yml`"), "docker/a.yml": "" }))).toEqual([
      missing("docker/missing.yml"),
    ]);
  });

  it("ADR も検査すること", () => {
    expect(violations(repo(cite("`tools/a.ts`", "docs/adr/0002-nx.md")))).toEqual([
      missing("tools/a.ts", "docs/adr/0002-nx.md"),
    ]);
  });

  it("docs/ の下の Markdown ではないファイルを読み飛ばすこと", () => {
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

describe("docs/ への参照: 辺", () => {
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
  ])("%s を検査すること", (path) => {
    expect(violations(repo({ [path]: "docs/adr/9999\n" }))).toEqual([
      `${path} cites docs/adr/9999, which does not exist.${stagingHint}`,
    ]);
  });

  it("2 桁の番号の見出しを通すこと", () => {
    const files = withSetup(
      "# Setup\n\n## 10. Ubuntu の初期セットアップ\n",
      'docs/local-env-setup/setup.md ("Ubuntu の初期セットアップ")',
    );
    expect(violations(repo(files))).toEqual([]);
  });

  it.each([
    ["a number inside the heading", "## Node 24. Ubuntu", "Node Ubuntu"],
    ["text that is not a heading", "see # Ubuntu", "Ubuntu"],
  ])("%s を落とさないこと", (_, line, heading) => {
    const files = withSetup(`# Setup\n\n${line}\n`, `docs/local-env-setup/setup.md ("${heading}")`);
    expect(violations(repo(files))).toEqual([
      `lefthook.yml cites the heading "${heading}" in docs/local-env-setup/setup.md, which has no such heading.`,
    ]);
  });

  it("中身にかかわらず、見出しなしで引用されたファイルを通すこと", () => {
    expect(violations(repo(withSetup("# Setup", "docs/local-env-setup/setup.md")))).toEqual([]);
  });

  it("別の type のファイルを ADR に数えないこと", () => {
    const files = {
      "docs/adr/0003-notes.txt": "x\n",
      "lefthook.yml": `${base["lefthook.yml"] ?? ""}# docs/adr/0003\n`,
    };
    expect(violations(repo(files))).toEqual([
      `lefthook.yml cites docs/adr/0003, which does not exist.${stagingHint}`,
    ]);
  });
});

describe("設定とスクリプトからコードのファイルへの参照", () => {
  const violations = failuresOf(codePathReferences);
  const cite = (line: string, path = "lefthook.yml") => ({ [path]: `${line}\n` });
  const missing = (path: string, source = "lefthook.yml") =>
    `${source} names ${path}, which does not exist. The file was moved or removed: write its path now, or the directory it is in.${stagingHint}`;

  it.each([
    ["a path", '- "packages/a/b.ts"', ["packages/a/b.ts"]],
    ["a path in a comment", "# see tools/a/b.ts for it", ["tools/a/b.ts"]],
    ["a path that ends a sentence", "# it is in apps/a/b.ts.", ["apps/a/b.ts"]],
    ["a path with a line number", "# tools/a.ts:12", ["tools/a.ts"]],
    ["a path in a dot directory", "# .github/workflows/a.yml", [".github/workflows/a.yml"]],
    ["a path in single quotes", "const p = 'packages/a/b.ts';", ["packages/a/b.ts"]],
  ])("存在する %s を通すこと", (_, line, exists) => {
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
    ["a dot inside a name that has no extension", "# packages/a.b/c"],
    // The limits in docs/tooling/ci.md: none of these is read.
    ["a path from its package", '"entry": "src/seed/index.ts"'],
    ["a path with escaped slashes in JSON", '"entry": "packages\\/a\\/b.ts"'],
    [
      "an untracked output outside the roots",
      "# coverage/coverage-final.json and .nx/cache/a.json",
    ],
    ["an untracked output under a root, as a glob", '- "apps/api/dist/**"'],
  ])("%s を、ツリーが持つべきファイルとして読まないこと", (_, line) => {
    expect(violations(repo(cite(line)))).toEqual([]);
  });

  it("スラッシュ付きのディレクトリを、その下にツリーのファイルがあるべきものとして読むこと", () => {
    expect(violations(repo({ ...cite("# packages/a/src/"), "packages/a/src/x.ts": "" }))).toEqual(
      [],
    );
    expect(violations(repo(cite("# packages/a/src/ and packages/b/")))).toEqual([
      missing("packages/a/src/"),
      missing("packages/b/"),
    ]);
  });

  it("相対 path を、それを挙げるファイルのディレクトリから解決すること", () => {
    const named = cite('import("../../../apps/c.ts") and "./packages/d.ts"', "packages/x/y/z.ts");
    expect(
      violations(repo({ ...named, "apps/c.ts": "", "packages/x/y/packages/d.ts": "" })),
    ).toEqual([]);
    expect(violations(repo(named))).toEqual([
      missing("../../../apps/c.ts", "packages/x/y/z.ts"),
      missing("./packages/d.ts", "packages/x/y/z.ts"),
    ]);
  });

  it("最上位ディレクトリをツリーから採るので、自分のディレクトリも読むこと", () => {
    expect(violations(repo({ ...cite("# docker/a/b.sh"), "docker/c.txt": "" }))).toEqual([
      missing("docker/a/b.sh"),
    ]);
    expect(violations(repo(cite("# docker/a/b.sh")))).toEqual([]);
  });

  it("設定、workflow、スクリプトの中の存在しない path を拒否すること", () => {
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

  it("ファイルごとに path を 1 回、行のすべての path を挙げること", () => {
    expect(violations(repo(cite("# apps/a/x.ts apps/a/x.ts packages/b/y.ts")))).toEqual([
      missing("apps/a/x.ts"),
      missing("packages/b/y.ts"),
    ]);
  });

  it("docs/ の外の Markdown の path も拒否すること", () => {
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
  ])("わざと存在しないファイルを挙げてよい %s を検査しないこと", (path) => {
    expect(violations(repo({ [path]: "apps/a/missing.ts\n" }))).toEqual([]);
  });

  it("バイナリファイルを読まないこと", () => {
    expect(violations(repo({ "assets/a.png": "\0apps/a/missing.ts\n" }))).toEqual([]);
  });

  it("ディレクトリのないツリーでは何も読まないこと", () => {
    const flat = {
      tracked: new Map([["a.md", "100644"]]),
      untrackedSteering: [],
      viteHooks: false,
    };
    // Without a root, the pattern would read an absolute path (/usr/local/a.sh) as a path of the tree.
    expect(violations({ ...flat, read: () => "apps/a/missing.ts and /usr/local/a.sh\n" })).toEqual(
      [],
    );
  });

  it("ルートのファイルの名前を最上位ディレクトリと取り違えないこと", () => {
    expect(violations(repo({ ...cite("# see notes.md/a.ts"), "notes.md": "" }))).toEqual([]);
  });

  it("research/ と .agents/ を、コードの最上位ディレクトリとして読まないこと", () => {
    expect(
      violations(
        repo({
          ...cite("# research/b/missing.ts and .agents/c/missing.ts"),
          "research/a.md": "",
          ".agents/skills/a.md": "",
        }),
      ),
    ).toEqual([]);
  });

  it("相対 path がどこにも着かない、ディレクトリのファイルからのルート単体を読み飛ばすこと", () => {
    expect(violations(repo(cite("# ../packages/ and ../../apps/", "tools/b/c.yml")))).toEqual([]);
  });

  it.each([
    "tools/mise.lock",
    "mise.lock.bak",
    "CHANGELOG.mdx",
    "docs-CHANGELOG.md",
    "apps/web/src/a.test.tsx.snap",
    "apps/web/src/a.test.ts.bak",
    "packages/a/src/db.gen.tsx",
    "apps/web/.gitignore.bak",
  ])("読まないものに見えるだけの名前の %s を検査すること", (path) => {
    expect(violations(repo({ [path]: "apps/a/missing.ts\n" }))).toEqual([
      missing("apps/a/missing.ts", path),
    ]);
  });

  it("ツリーのルートの changelog を検査しないこと", () => {
    expect(violations(repo({ "CHANGELOG.md": "apps/a/missing.ts\n" }))).toEqual([]);
  });
});
