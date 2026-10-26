// The rules of repo-policy, called on a small repository held in memory: each case breaks one file of
// a repository that passes, and expects the message that names the problem. Reading git and the
// working tree (and the staged mode) is in cli.test.ts.
import { describe, expect, it } from "vite-plus/test";
import { passingRepo } from "./fixtures/passing-repo.ts";
import { violations, type Repo } from "./rules.ts";

const base = passingRepo;

interface Options {
  // Index modes that differ from the default (100755 for *.sh, 100644 otherwise).
  readonly modes?: Record<string, string>;
  readonly untracked?: Record<string, string>;
  readonly viteHooks?: boolean;
}

// A repository with the files of `base`, changed by `files` (undefined removes a file).
function repo(files: Record<string, string | undefined> = {}, options: Options = {}): Repo {
  const merged = new Map<string, string>();
  for (const [path, text] of Object.entries({ ...base, ...files }))
    if (text !== undefined) merged.set(path, text);
  const tracked = new Map(
    [...merged.keys()].map((path) => [
      path,
      options.modes?.[path] ?? (path.endsWith(".sh") ? "100755" : "100644"),
    ]),
  );
  const untracked = Object.entries(options.untracked ?? {});
  for (const [path, text] of untracked) merged.set(path, text);
  return {
    tracked,
    untrackedSteering: untracked.map(([path]) => path),
    viteHooks: options.viteHooks ?? false,
    read: (path) => merged.get(path),
  };
}

const json = (value: unknown): string => JSON.stringify(value, undefined, 2);

describe("violations", () => {
  it("finds nothing in a repository that keeps every rule", () => {
    expect(violations(repo())).toEqual([]);
  });
});

describe("ADR 0002: Nx runs the tasks", () => {
  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "refuses @nx/vite in %s of any package.json",
    (field) => {
      expect(
        violations(repo({ "apps/api/package.json": json({ [field]: { "@nx/vite": "24.0.0" } }) })),
      ).toEqual([
        "apps/api/package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
      ]);
    },
  );

  it("passes a package.json that names @nx/vite outside its dependencies", () => {
    expect(
      violations(repo({ "apps/api/package.json": json({ description: "not @nx/vite" }) })),
    ).toEqual([]);
  });

  it("refuses a run block in a vite.config.ts", () => {
    expect(
      violations(
        repo({ "apps/web/vite.config.ts": "export default {\n  run: { cache: true },\n};\n" }),
      ),
    ).toEqual([
      "apps/web/vite.config.ts has a `run` block. Task running and caching belong to Nx (docs/adr/0002).",
    ]);
  });

  it("passes a run key that is not at the top of the config", () => {
    expect(
      violations(
        repo({ "apps/web/vite.config.ts": "export default {\n  test: { run: 1 },\n};\n" }),
      ),
    ).toEqual([]);
  });
});

describe("ADR 0001: lefthook owns the Git hooks", () => {
  const message = ".vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001).";

  it("refuses a .vite-hooks directory in the working tree", () => {
    expect(violations(repo({}, { viteHooks: true }))).toEqual([message]);
  });

  it("refuses a tracked file in .vite-hooks", () => {
    expect(violations(repo({ ".vite-hooks/pre-commit": "x\n" }))).toEqual([message]);
  });
});

describe("ADR 0003, 0009: one betterleaks version", () => {
  it("refuses a .betterleaks.toml whose minimum version is not the one in mise.toml", () => {
    expect(violations(repo({ "mise.toml": '[tools]\nbetterleaks = "9.9.9"\n' }))).toEqual([
      ".betterleaks.toml betterleaksMinVersion must equal the betterleaks version in mise.toml (9.9.9).",
    ]);
  });

  it.each([
    ["no betterleaks", '[tools]\nshellcheck = "0.11.0"\n'],
    ["a version that is not a string", "[tools]\nbetterleaks = 1\n"],
    ["betterleaks outside [tools]", '[env]\nbetterleaks = "1.9.0"\n'],
  ])("refuses a mise.toml with %s", (_, text) => {
    expect(violations(repo({ "mise.toml": text }))).toEqual([
      "mise.toml must pin betterleaks to an exact version (docs/adr/0009).",
    ]);
  });

  it("reads the version however the TOML is written", () => {
    const mise = "[tools]\n# pinned\n\"betterleaks\"   =   '1.9.0' # v1 only\n";
    expect(violations(repo({ "mise.toml": mise }))).toEqual([]);
  });

  it("refuses a repository without mise.toml", () => {
    expect(violations(repo({ "mise.toml": undefined }))).toEqual([
      "mise.toml must pin betterleaks to an exact version (docs/adr/0009).",
    ]);
  });

  it("refuses a .betterleaks.toml without the minimum version", () => {
    expect(
      violations(repo({ ".betterleaks.toml": "[extend]\nbetterleaksMinVersion = '1.9.0'\n" })),
    ).toEqual([
      ".betterleaks.toml betterleaksMinVersion must equal the betterleaks version in mise.toml (1.9.0).",
    ]);
  });
});

describe("ADR 0007: apps/api/src uses Web standard APIs only", () => {
  const config = base["vite.config.ts"] ?? "";

  it.each(["import/no-nodejs-modules", "no-restricted-imports", "no-restricted-globals"])(
    "refuses a vite.config.ts that turns %s off",
    (rule) => {
      const off = config.replace(new RegExp(`"${rule}": (\\[\\s*)?"error"`), `"${rule}": "off"`);
      expect(violations(repo({ "vite.config.ts": off }))).toEqual([
        `vite.config.ts must set ${rule} to error for apps/api/src (docs/adr/0007).`,
      ]);
    },
  );

  it("refuses a vite.config.ts that only sets a rule of a similar name", () => {
    const other = config.replace('"no-restricted-globals"', '"my/no-restricted-globals"');
    expect(violations(repo({ "vite.config.ts": other }))).toEqual([
      "vite.config.ts must set no-restricted-globals to error for apps/api/src (docs/adr/0007).",
    ]);
  });

  it("refuses a rule whose error is a later option, not its severity", () => {
    const later = config.replace(
      '"no-restricted-globals": ["error", { name: "process" }]',
      '"no-restricted-globals": ["warn", "error"]',
    );
    expect(violations(repo({ "vite.config.ts": later }))).toEqual([
      "vite.config.ts must set no-restricted-globals to error for apps/api/src (docs/adr/0007).",
    ]);
  });
});

describe("steering frontmatter (docs/knowledge/steering-authoring.md)", () => {
  const guide = "(docs/knowledge/steering-authoring.md)";
  const steering = (frontmatter: string) => ({
    ".kiro/steering/x.md": `---\n${frontmatter}---\n\n# X\n`,
  });

  it("passes each inclusion, and fileMatch with a one-line array", () => {
    for (const inclusion of ["always", "manual", "auto"])
      expect(
        violations(repo(steering(`inclusion: ${inclusion}\nname: x\ndescription: d\n`))),
      ).toEqual([]);
    expect(
      violations(
        repo(
          steering(
            'inclusion: fileMatch\nfileMatchPattern: ["**/*.ts", "a"]\nname: x\ndescription: d\n',
          ),
        ),
      ),
    ).toEqual([]);
  });

  it("refuses a file without frontmatter", () => {
    expect(violations(repo({ ".kiro/steering/x.md": "no frontmatter\n" }))).toEqual([
      `.kiro/steering/x.md: must start with a frontmatter block ${guide}`,
    ]);
  });

  it("refuses frontmatter that is not closed", () => {
    expect(
      violations(
        repo({ ".kiro/steering/x.md": "---\ninclusion: auto\nname: x\ndescription: d\n" }),
      ),
    ).toEqual([`.kiro/steering/x.md: frontmatter is not closed ${guide}`]);
  });

  it("names every missing or wrong field", () => {
    expect(violations(repo(steering("inclusion: sometimes\nname: y\n")))).toEqual([
      `.kiro/steering/x.md: inclusion must be always, fileMatch, manual or auto ${guide}`,
      `.kiro/steering/x.md: name must be "x" ${guide}`,
      `.kiro/steering/x.md: description is required ${guide}`,
    ]);
  });

  it("refuses an empty description", () => {
    expect(violations(repo(steering('inclusion: auto\nname: x\ndescription: ""\n')))).toEqual([
      `.kiro/steering/x.md: description is required ${guide}`,
    ]);
  });

  it("requires fileMatchPattern for fileMatch, and only for fileMatch", () => {
    expect(violations(repo(steering("inclusion: fileMatch\nname: x\ndescription: d\n")))).toEqual([
      `.kiro/steering/x.md: fileMatchPattern is required for inclusion: fileMatch ${guide}`,
    ]);
    expect(
      violations(
        repo(steering('inclusion: auto\nfileMatchPattern: ["a"]\nname: x\ndescription: d\n')),
      ),
    ).toEqual([`.kiro/steering/x.md: fileMatchPattern is only for inclusion: fileMatch ${guide}`]);
  });

  it.each([
    ["a block list", "fileMatchPattern:\n  - a\n"],
    ["a string", "fileMatchPattern: a\n"],
  ])("refuses fileMatchPattern written as %s", (_, pattern) => {
    expect(
      violations(repo(steering(`inclusion: fileMatch\n${pattern}name: x\ndescription: d\n`))),
    ).toEqual([`.kiro/steering/x.md: fileMatchPattern must be a one-line array ${guide}`]);
  });

  it("refuses frontmatter that is not valid YAML", () => {
    expect(
      violations(repo(steering("inclusion: auto\nname: x\ndescription: javascript: x\n"))),
    ).toEqual([
      `.kiro/steering/x.md: frontmatter is not valid YAML (Nested mappings are not allowed in compact mappings) ${guide}`,
    ]);
  });

  it("checks untracked steering files too", () => {
    expect(
      violations(repo({}, { untracked: { ".kiro/steering/broken.md": "no frontmatter\n" } })),
    ).toEqual([`.kiro/steering/broken.md: must start with a frontmatter block ${guide}`]);
  });

  it("checks only the Markdown files directly in .kiro/steering", () => {
    expect(
      violations(repo({ ".kiro/steering/notes.txt": "x\n", ".kiro/skills/a/SKILL.md": "x\n" })),
    ).toEqual([]);
  });
});

describe("git on another repository, only from sh tests isolated by lib.sh", () => {
  const anywhere = (path: string) =>
    `${path} runs git on another repository. Move that code into a scripts/test/*.test.sh that sources lib.sh, or run git only on this repository.`;

  it.each([
    ["git init", "git init -q /tmp/x"],
    ["git clone", "git clone -q a b"],
    ["git -C", 'git -C "$1" commit -m x'],
    ["--git-dir", "git --git-dir=/tmp/x/.git log"],
    ["GIT_DIR=", "GIT_DIR=/tmp/x git log"],
    ["git init at the end of a line", "cd /tmp/x && git init"],
  ])("refuses %s in a script outside scripts/test", (_, line) => {
    expect(violations(repo({ ".kiro/hooks/other.sh": `#!/bin/sh\n${line}\n` }))).toEqual([
      anywhere(".kiro/hooks/other.sh"),
    ]);
  });

  it.each([
    ["a word that ends in git", "legit init"],
    ["git with another command", "git initialize"],
    ["a git command on this repository", "git rev-parse --show-toplevel"],
  ])("passes %s", (_, line) => {
    expect(violations(repo({ "scripts/other.sh": `#!/bin/sh\n${line}\n` }))).toEqual([]);
  });

  it("refuses a test that does not source lib.sh", () => {
    expect(
      violations(repo({ "scripts/test/guard-push.test.sh": "#!/bin/sh\ngit clone -q a b\n" })),
    ).toEqual([
      "scripts/test/guard-push.test.sh runs git on another repository but does not source scripts/test/lib.sh.",
    ]);
  });

  it("does not count a test that only names lib.sh in a comment", () => {
    const text = '#!/bin/sh\n# . "$(dirname "$0")/lib.sh"\ngit init -q x\n';
    expect(violations(repo({ "scripts/test/guard-push.test.sh": text }))).toEqual([
      "scripts/test/guard-push.test.sh runs git on another repository but does not source scripts/test/lib.sh.",
    ]);
  });

  it("refuses a script that sources lib.sh outside scripts/test", () => {
    const text = '#!/bin/sh\n. "$(dirname "$0")/lib.sh"\ngit init -q x\n';
    expect(violations(repo({ "scripts/test/nested/a.test.sh": text }))).toEqual([
      anywhere("scripts/test/nested/a.test.sh"),
    ]);
  });

  it("applies only to shell scripts, and not to the upstream skills", () => {
    expect(
      violations(
        repo({
          "tools/scripts/src/checks/other.ts": "// git -C dir, git init, GIT_DIR=x\n",
          "scripts/docs-links.mjs": "// git init x\n",
          ".agents/skills/a/run.sh": "git init x\n",
          ".kiro/skills/a/run.sh": "git init x\n",
        }),
      ),
    ).toEqual([]);
  });
});

describe("shell scripts are executable in git", () => {
  it("refuses a shell script whose index mode is not 100755", () => {
    expect(violations(repo({}, { modes: { "scripts/guard-push.sh": "100644" } }))).toEqual([
      "scripts/guard-push.sh is not executable in git. Run `chmod +x scripts/guard-push.sh` and stage it again.",
    ]);
  });

  it("does not check the upstream skills", () => {
    const modes = { ".agents/skills/a/x.sh": "100644", ".kiro/skills/a/x.sh": "100644" };
    expect(
      violations(repo({ ".agents/skills/a/x.sh": "x\n", ".kiro/skills/a/x.sh": "x\n" }, { modes })),
    ).toEqual([]);
  });
});

describe("ADR 0013: one Node.js major version", () => {
  it.each(["v24.1.2\n", "24\n", "24.22.1\n\n# comment\n"])(
    "passes a .node-version of %j",
    (version) => {
      expect(violations(repo({ ".node-version": version }))).toEqual([]);
    },
  );

  it("refuses a .node-version that moves alone", () => {
    expect(violations(repo({ ".node-version": "25\n" }))).toEqual([
      "package.json engines.node (24) must be Node.js 25, the major of .node-version (docs/adr/0013).",
      "pnpm-workspace.yaml catalog @types/node (24) must be Node.js 25, the major of .node-version (docs/adr/0013).",
      "apps/api/vite.config.ts builds for node24, but .node-version is Node.js 25 (docs/adr/0013).",
    ]);
  });

  it.each(["lts\n", "", undefined])("refuses a .node-version of %j", (version) => {
    expect(violations(repo({ ".node-version": version }))).toEqual([
      ".node-version must start with a Node.js version such as 24 or 24.22.1 (docs/adr/0013).",
    ]);
  });

  it("refuses engines.node of another major, and names an unreadable one", () => {
    expect(violations(repo({ "package.json": json({ engines: { node: ">=25" } }) }))).toEqual([
      "package.json engines.node (25) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
    expect(violations(repo({ "package.json": json({}) }))).toEqual([
      "package.json engines.node (unreadable) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
  });

  it("refuses a @types/node catalog of another major, and names an unreadable one", () => {
    expect(
      violations(repo({ "pnpm-workspace.yaml": 'catalog:\n  "@types/node": 25.0.1\n' })),
    ).toEqual([
      "pnpm-workspace.yaml catalog @types/node (25) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
    expect(violations(repo({ "pnpm-workspace.yaml": "packages: []\n" }))).toEqual([
      "pnpm-workspace.yaml catalog @types/node (unreadable) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
  });

  it("reads the catalog however the YAML is written", () => {
    const flow = 'catalog: { "@types/node": "~24.3.0" }\n';
    expect(violations(repo({ "pnpm-workspace.yaml": flow }))).toEqual([]);
  });

  it("refuses a build target of another major in any vite.config.ts", () => {
    expect(
      violations(
        repo({ "apps/web/vite.config.ts": 'export default { build: { target: "node25" } };\n' }),
      ),
    ).toEqual([
      "apps/web/vite.config.ts builds for node25, but .node-version is Node.js 24 (docs/adr/0013).",
    ]);
  });
});

describe("ADR numbers are unique", () => {
  it("refuses two ADRs with the same number", () => {
    expect(violations(repo({ "docs/adr/0001-duplicate.md": "# x\n" }))).toEqual([
      "ADR 0001 is used by more than one file: docs/adr/0001-duplicate.md docs/adr/0001-lefthook.md",
    ]);
  });

  it("does not count files that are not ADRs", () => {
    expect(
      violations(repo({ "docs/adr/index.md": "# x\n", "docs/adr/0001/notes.md": "# x\n" })),
    ).toEqual([]);
  });
});

describe("every sh test runs in a workflow and in the pre-commit hook", () => {
  const test = "scripts/test/new.test.sh";
  const ci = base[".github/workflows/ci.yml"] ?? "";
  const lefthook = base["lefthook.yml"] ?? "";
  const inCi = ci.replace(
    "scripts/test/guard-push.test.sh",
    `scripts/test/guard-push.test.sh ${test}`,
  );
  const inHook = `${lefthook}    - name: new\n      run: sh scripts/test/run.sh ${test}\n`;
  const notInCi = `${test} is not run by any workflow. Add it to the Script tests step of .github/workflows/ci.yml.`;
  const notInHook = `${test} is not run by the pre-commit hook. Add a job for it to lefthook.yml.`;
  const files = (extra: Record<string, string>) => ({ [test]: "#!/bin/sh\n", ...extra });

  it("passes a test that a workflow and lefthook.yml run", () => {
    expect(
      violations(repo(files({ ".github/workflows/ci.yml": inCi, "lefthook.yml": inHook }))),
    ).toEqual([]);
  });

  it("counts a run in any workflow, and in a nested lefthook group or command", () => {
    const other = `jobs:\n  scan:\n    steps:\n      - run: |\n          sh scripts/test/run.sh ${test}\n`;
    const group = `pre-commit:\n  jobs:\n    - group:\n        jobs:\n          - run: sh ${test}\ncommit-msg:\n  commands:\n    x:\n      run: sh scripts/test/run.sh scripts/test/guard-push.test.sh\n`;
    expect(
      violations(repo(files({ ".github/workflows/scan.yaml": other, "lefthook.yml": group }))),
    ).toEqual([]);
  });

  it("refuses a test that no workflow runs", () => {
    expect(violations(repo(files({ "lefthook.yml": inHook })))).toEqual([notInCi]);
  });

  it("refuses a test that the pre-commit hook does not run", () => {
    expect(violations(repo(files({ ".github/workflows/ci.yml": inCi })))).toEqual([notInHook]);
  });

  it("does not count a test named only in a comment, a name or a glob", () => {
    const comment = `${lefthook}    # ${test}\n    - name: ${test}\n      glob: ${test}\n      run: "true"\n`;
    const workflowComment = `${ci}# ${test}\n`;
    expect(
      violations(
        repo(files({ ".github/workflows/ci.yml": workflowComment, "lefthook.yml": comment })),
      ),
    ).toEqual([notInCi, notInHook]);
  });

  it("does not count a workflow outside .github/workflows", () => {
    expect(
      violations(repo(files({ ".github/other/ci.yml": inCi, "lefthook.yml": inHook }))),
    ).toEqual([notInCi]);
  });
});

describe("every job of ci.yml is in the needs of main", () => {
  const ci = base[".github/workflows/ci.yml"] ?? "";
  const extra = `${ci}  extra:\n    runs-on: ubuntu-26.04\n    steps: []\n`;
  const notNeeded =
    '.github/workflows/ci.yml: the main job must list `extra` in its needs, or a failure of `extra` will not block a merge (docs/tooling/ci.md ("ci.yml の検証")).';

  it("refuses a job that main does not need", () => {
    expect(violations(repo({ ".github/workflows/ci.yml": extra }))).toEqual([notNeeded]);
  });

  it.each([
    ["a one-line list", "    needs: [checks, nx, extra]"],
    ["a block list", "    needs:\n      - checks\n      - nx\n      - extra"],
    ["a flow list over several lines", "    needs: [\n      checks,\n      nx, extra,\n    ]"],
  ])("reads needs written as %s", (_, needs) => {
    const ci = extra.replace("    needs: [checks, nx]", needs);
    expect(violations(repo({ ".github/workflows/ci.yml": ci }))).toEqual([]);
  });

  // Another workflow runs the sh test, so that only the jobs of ci.yml can fail these cases.
  const tests = {
    ".github/workflows/tests.yml":
      "jobs:\n  t:\n    steps:\n      - run: sh scripts/test/guard-push.test.sh\n",
  };

  it("reads needs written as a single job", () => {
    const single = "jobs:\n  build:\n    steps: []\n  main:\n    needs: build\n    steps: []\n";
    expect(violations(repo({ ".github/workflows/ci.yml": single, ...tests }))).toEqual([]);
  });

  it("refuses every job when there is no main", () => {
    const none = "jobs:\n  build:\n    steps: []\n";
    expect(violations(repo({ ".github/workflows/ci.yml": none, ...tests }))).toEqual([
      '.github/workflows/ci.yml: the main job must list `build` in its needs, or a failure of `build` will not block a merge (docs/tooling/ci.md ("ci.yml の検証")).',
    ]);
  });
});

describe("configuration files that cannot be parsed", () => {
  it.each([
    [".github/workflows/ci.yml", "jobs: [\n"],
    ["lefthook.yml", "pre-commit: {\n"],
    ["pnpm-workspace.yaml", "catalog: [\n"],
  ])("names %s and the parser error", (path, text) => {
    const failures = violations(repo({ [path]: text }));
    expect(
      failures.filter((failure) => failure.startsWith(`${path} is not valid YAML (`)),
    ).toHaveLength(1);
  });

  it.each([
    ["mise.toml", "[tools\n"],
    [".betterleaks.toml", "betterleaksMinVersion = \n"],
  ])("names %s and the parser error", (path, text) => {
    const failures = violations(repo({ [path]: text }));
    expect(
      failures.filter((failure) => failure.startsWith(`${path} is not valid TOML (`)),
    ).toHaveLength(1);
  });

  it("names a package.json that is not JSON", () => {
    expect(violations(repo({ "apps/api/package.json": "{\n" }))[0]).toMatch(
      /^apps\/api\/package\.json is not valid JSON \(.+\)$/,
    );
  });
});

describe("references to docs/ from outside docs/", () => {
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
    "scripts/test/run.sh",
    "tools/scripts/src/checks/adr-check/rules.test.ts",
    "tools/scripts/src/checks/repo-policy/rules.test.ts",
    "tools/scripts/src/checks/repo-policy/fixtures/passing-repo.ts",
    "pnpm-lock.yaml",
  ])("does not check %s, which may cite missing docs on purpose", (path) => {
    expect(violations(repo({ [path]: "docs/adr/9999\n" }))).toEqual([]);
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

// The edges of each check: inputs just inside and just outside what it matches.
describe("ADR 0002: the edges", () => {
  it("refuses @nx/vite in the root package.json", () => {
    const root = json({ engines: { node: "^24" }, devDependencies: { "@nx/vite": "24.0.0" } });
    expect(violations(repo({ "package.json": root }))).toEqual([
      "package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
    ]);
  });

  it("passes dependency fields that are null", () => {
    expect(violations(repo({ "apps/api/package.json": json({ dependencies: null }) }))).toEqual([]);
  });

  it("refuses a run block with spaces before its colon", () => {
    const config = `${base["vite.config.ts"] ?? ""}  run  : {}\n`;
    expect(violations(repo({ "vite.config.ts": config }))).toEqual([
      "vite.config.ts has a `run` block. Task running and caching belong to Nx (docs/adr/0002).",
    ]);
  });

  it("passes a run key nested deeper in the config", () => {
    const nested = "export default {\n  test: {\n    run: 1,\n  },\n};\n";
    expect(violations(repo({ "apps/web/vite.config.ts": nested }))).toEqual([]);
  });
});

describe("steering frontmatter: the edges", () => {
  const guide = "(docs/knowledge/steering-authoring.md)";

  it("names the file by its whole name", () => {
    expect(violations(repo({ ".kiro/steering/long-name.md": "no frontmatter\n" }))).toEqual([
      `.kiro/steering/long-name.md: must start with a frontmatter block ${guide}`,
    ]);
  });

  it.each(['" "', "1"])("refuses a description of %s", (description) => {
    const text = `---\ninclusion: auto\nname: x\ndescription: ${description}\n---\n`;
    expect(violations(repo({ ".kiro/steering/x.md": text }))).toEqual([
      `.kiro/steering/x.md: description is required ${guide}`,
    ]);
  });

  it("does not check other files that look like steering", () => {
    expect(
      violations(
        repo({
          ".kiro/steering/old.md.bak": "x\n",
          ".kiro/steering/sub/x.md": "x\n",
          "apps/.kiro/steering/x.md": "x\n",
        }),
      ),
    ).toEqual([]);
  });
});

describe("git on another repository: the edges", () => {
  const anywhere = (path: string) =>
    `${path} runs git on another repository. Move that code into a scripts/test/*.test.sh that sources lib.sh, or run git only on this repository.`;

  it.each([
    ["git and init apart", "#!/bin/sh\ngit  init x\n"],
    ["git and -C apart", "#!/bin/sh\ngit  -C x log\n"],
    ["git at the start of the file", "git clone a b\n"],
    ["git init at the end of the file", "#!/bin/sh\ngit init"],
  ])("refuses %s", (_, text) => {
    expect(violations(repo({ ".kiro/hooks/other.sh": text }))).toEqual([
      anywhere(".kiro/hooks/other.sh"),
    ]);
  });

  it("does not count a line that sources lib.sh and does more", () => {
    const text = '#!/bin/sh\n. "$(dirname "$0")/lib.sh" || true\ngit init -q x\n';
    expect(violations(repo({ "scripts/test/guard-push.test.sh": text }))).toEqual([
      "scripts/test/guard-push.test.sh runs git on another repository but does not source scripts/test/lib.sh.",
    ]);
  });

  it("refuses a test outside scripts/test that sources lib.sh", () => {
    const text = '#!/bin/sh\n. "$(dirname "$0")/lib.sh"\ngit init -q x\n';
    expect(violations(repo({ "tools/scripts/test/a.test.sh": text }))).toEqual([
      anywhere("tools/scripts/test/a.test.sh"),
    ]);
  });
});

describe("ADR 0013: the edges", () => {
  it("refuses a .node-version that does not start with the version", () => {
    expect(violations(repo({ ".node-version": "lts-24\n" }))).toEqual([
      ".node-version must start with a Node.js version such as 24 or 24.22.1 (docs/adr/0013).",
    ]);
  });

  it("reads a @types/node catalog entry that YAML reads as a number", () => {
    expect(violations(repo({ "pnpm-workspace.yaml": 'catalog:\n  "@types/node": 24\n' }))).toEqual(
      [],
    );
  });

  it.each([["latest"], [["24"]], [{ major: 24 }]])(
    "names an engines.node of %j unreadable",
    (node) => {
      expect(violations(repo({ "package.json": json({ engines: { node } }) }))).toEqual([
        "package.json engines.node (unreadable) must be Node.js 24, the major of .node-version (docs/adr/0013).",
      ]);
    },
  );

  it("reads a build target written without a space", () => {
    const config = 'export default { build: { target:"node25" } };\n';
    expect(violations(repo({ "apps/web/vite.config.ts": config }))).toEqual([
      "apps/web/vite.config.ts builds for node25, but .node-version is Node.js 24 (docs/adr/0013).",
    ]);
  });
});

describe("ADR numbers: the edges", () => {
  it("does not count files that only look like ADRs", () => {
    expect(
      violations(repo({ "docs/adr/0001-old.md.bak": "# x\n", "apps/docs/adr/0001-a.md": "# x\n" })),
    ).toEqual([]);
  });
});

describe("sh test lists: the edges", () => {
  const test = "scripts/test/new.test.sh";
  const ci = base[".github/workflows/ci.yml"] ?? "";
  const inCi = ci.replace(
    "scripts/test/guard-push.test.sh",
    `scripts/test/guard-push.test.sh ${test}`,
  );
  const inHook = `${base["lefthook.yml"] ?? ""}    - name: new\n      run: sh scripts/test/run.sh ${test}\n`;

  it.each(["apps/web/.github/workflows/ci.yml", ".github/workflows/ci.yml.bak"])(
    "does not count %s as a workflow",
    (path) => {
      expect(
        violations(repo({ [test]: "#!/bin/sh\n", [path]: inCi, "lefthook.yml": inHook })),
      ).toEqual([
        `${test} is not run by any workflow. Add it to the Script tests step of .github/workflows/ci.yml.`,
      ]);
    },
  );

  it("skips a run key that holds settings", () => {
    // Before the jobs, so that the check meets the settings first.
    const defaults = `defaults:\n  run:\n    shell: bash\n${inCi}`;
    expect(
      violations(
        repo({
          [test]: "#!/bin/sh\n",
          ".github/workflows/ci.yml": defaults,
          "lefthook.yml": inHook,
        }),
      ),
    ).toEqual([]);
  });

  it("lists only the sh tests directly in scripts/test", () => {
    expect(
      violations(
        repo({ "scripts/test/notes.test.sh.txt": "x\n", "tools/scripts/test/a.test.sh": "x\n" }),
      ),
    ).toEqual([]);
  });
});

describe("configuration files that cannot be parsed: the messages", () => {
  it.each([
    [
      ".github/workflows/ci.yml",
      "jobs: [\n",
      "YAML (YAMLParseError: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1)",
    ],
    ["mise.toml", "[tools\n", "TOML (Error: Invalid TOML document: illegal character in key)"],
    [
      "apps/api/package.json",
      "{\n",
      "JSON (SyntaxError: Expected property name or '}' in JSON at position 2 (line 2 column 1))",
    ],
  ])("names %s and the first line of the parser error", (path, text, error) => {
    expect(violations(repo({ [path]: text }))[0]).toBe(`${path} is not valid ${error}`);
  });

  it("reports a file once, however many checks read it", () => {
    const failures = violations(repo({ "package.json": "{\n" }));
    expect(failures.filter((failure) => failure.startsWith("package.json is not valid"))).toEqual([
      "package.json is not valid JSON (SyntaxError: Expected property name or '}' in JSON at position 2 (line 2 column 1))",
    ]);
  });
});

describe("references to docs/: the edges", () => {
  const withSetup = (setup: string, line: string) => ({
    "docs/local-env-setup/setup.md": setup,
    "lefthook.yml": `${base["lefthook.yml"] ?? ""}# ${line}\n`,
  });

  it.each([
    "apps/docs/a.md",
    "apps/.agents/a.sh",
    "apps/.kiro/skills/a.md",
    "apps/scripts/test/a.ts",
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
