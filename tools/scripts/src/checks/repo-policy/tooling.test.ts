// The checks of tool settings and repository files
// (./tooling.ts), each called alone on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import {
  apiDependencies,
  migration,
  passingRepo,
  renovateConfig,
} from "./fixtures/passing-repo.ts";
import { apiManifest, failuresOf, json, repo } from "./fixtures/repo.ts";
import {
  executableScripts,
  gitOnOtherRepositories,
  lefthookOwnsHooks,
  migrationsGoForward,
  miseLockHasOnlyLinuxX64,
  noWorkspaceInCatalog,
  nxRunsTasks,
  oneBetterleaks,
  oneNodeMajor,
  onePostgresVersion,
  renovateAutomergeIsBounded,
  shellScriptsHaveTests,
  steeringFrontmatter,
  uniqueAdrNumbers,
} from "./tooling.ts";

const base = passingRepo;

describe("ADR 0002: Nx がタスクを実行すること", () => {
  const violations = failuresOf(nxRunsTasks);
  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "どの package.json の %s にも @nx/vite を拒否すること",
    (field) => {
      expect(
        violations(
          repo({
            "apps/api/package.json": apiManifest(
              field === "dependencies"
                ? { dependencies: { ...apiDependencies, "@nx/vite": "24.0.0" } }
                : { [field]: { "@nx/vite": "24.0.0" } },
            ),
          }),
        ),
      ).toEqual([
        "apps/api/package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
      ]);
    },
  );

  it("dependencies の外に @nx/vite を挙げる package.json を通すこと", () => {
    expect(
      violations(repo({ "apps/api/package.json": apiManifest({ description: "not @nx/vite" }) })),
    ).toEqual([]);
  });

  it("vite.config.ts の run ブロックを拒否すること", () => {
    expect(
      violations(
        repo({ "apps/web/vite.config.ts": "export default {\n  run: { cache: true },\n};\n" }),
      ),
    ).toEqual([
      "apps/web/vite.config.ts has a `run` block. Task running and caching belong to Nx (docs/adr/0002).",
    ]);
  });

  it("設定の先頭にない run キーを通すこと", () => {
    expect(
      violations(
        repo({ "apps/web/vite.config.ts": "export default {\n  test: { run: 1 },\n};\n" }),
      ),
    ).toEqual([]);
  });
});

describe("ADR 0001: lefthook が Git hook を持つこと", () => {
  const violations = failuresOf(lefthookOwnsHooks);
  const message = ".vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001).";

  it("作業ツリーの .vite-hooks ディレクトリを拒否すること", () => {
    expect(violations(repo({}, { viteHooks: true }))).toEqual([message]);
  });

  it(".vite-hooks の追跡されたファイルを拒否すること", () => {
    expect(violations(repo({ ".vite-hooks/pre-commit": "x\n" }))).toEqual([message]);
  });
});

describe("ADR 0009: mise.lock が linux-x64 だけを記録すること", () => {
  const violations = failuresOf(miseLockHasOnlyLinuxX64);
  const lock = (...platforms: string[]): string =>
    [
      "lockfile_version = 3",
      "",
      "[[tools.zizmor]]",
      'version = "1.32.0"',
      "",
      ...platforms.flatMap((platform) => [
        `[tools.zizmor."platforms.${platform}"]`,
        'checksum = "sha256:00"',
        "",
      ]),
    ].join("\n");

  it("linux-x64 を記録する lock を通すこと", () => {
    expect(violations(repo({ "mise.lock": lock("linux-x64") }))).toEqual([]);
  });

  it("linux-x64 ではないプラットフォームを拒否し、道具を挙げること", () => {
    expect(violations(repo({ "mise.lock": lock("linux-x64", "macos-arm64") }))).toEqual([
      "mise.lock records platforms.macos-arm64 of zizmor. Record linux-x64 only: run `mise lock --platform linux-x64` (docs/adr/0009).",
    ]);
  });

  it("同じ道具の 2 つ目の項目のプラットフォームを拒否すること", () => {
    const text = `${lock("linux-x64")}\n[[tools.zizmor]]\nversion = "1.33.0"\n\n[tools.zizmor."platforms.windows-x64"]\nchecksum = "sha256:00"\n`;
    expect(violations(repo({ "mise.lock": text }))).toEqual([
      "mise.lock records platforms.windows-x64 of zizmor. Record linux-x64 only: run `mise lock --platform linux-x64` (docs/adr/0009).",
    ]);
  });

  it("mise.lock のないリポジトリを通すこと", () => {
    expect(violations(repo({ "mise.lock": undefined }))).toEqual([]);
  });

  it("TOML でない mise.lock を 1 回だけ報告し、プラットフォームは報告しないこと", () => {
    expect(violations(repo({ "mise.lock": "tools: [" }))).toEqual([
      "mise.lock is not valid TOML (Error: Invalid TOML document: illegal character in key)",
    ]);
  });
});

describe("ADR 0055: Renovate が自分で merge する範囲が決まっていること", () => {
  const violations = failuresOf(renovateAutomergeIsBounded);
  const [npm, nodes, tsgo] = renovateConfig.packageRules;
  // The dependencies a person merges, as the passing configuration lists them.
  const mergedByPerson = [...(nodes?.matchDepNames ?? []), ...(tsgo?.matchPackageNames ?? [])];
  const withConfig = (change: Record<string, unknown>): ReturnType<typeof repo> =>
    repo({ "renovate.jsonc": json({ ...renovateConfig, ...change }) });
  const withRules = (...packageRules: unknown[]): ReturnType<typeof repo> =>
    withConfig({ packageRules });
  const npmRule = 'renovate.jsonc rule "Automerge minor and patch updates of npm packages"';
  const personRule =
    'renovate.jsonc rule "A person merges Node.js, pnpm, kiro-cli and the authentication libraries"';
  const missing = (dependency: string): string =>
    `renovate.jsonc needs a rule after the last automerge rule that sets automerge to false for ${dependency} and matches it by name only, not by update type, manager or version. A person merges it (docs/adr/0055).`;
  const outside = (where: string): string =>
    `renovate.jsonc sets automerge ${where}, so Renovate would merge more than the rules name. Set it only in lockFileMaintenance and in packageRules that name update types and managers (docs/adr/0055).`;

  it("auto-merge の規則と、人が merge する規則がそろった設定を通すこと", () => {
    expect(violations(repo())).toEqual([]);
  });

  it("人が merge する依存を、fixture が 8 つ挙げていること", () => {
    expect(mergedByPerson).toHaveLength(8);
  });

  it("renovate.jsonc のないリポジトリを通すこと", () => {
    expect(violations(repo({ "renovate.jsonc": undefined }))).toEqual([]);
  });

  it("読めない renovate.jsonc を 1 回だけ報告し、規則は報告しないこと", () => {
    expect(violations(repo({ "renovate.jsonc": "{" }))).toEqual([
      "renovate.jsonc is not valid JSONC (SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2))",
    ]);
  });

  describe("lockFileMaintenance と packageRules の外の automerge", () => {
    it.each([
      ["全体", { automerge: true }, "at the top level"],
      ["minor のブロック", { minor: { automerge: true } }, "in minor"],
      ["major のブロック", { major: { automerge: true } }, "in major"],
      ["manager のブロック", { "github-actions": { automerge: true } }, "in github-actions"],
      [
        "入れ子の lockFileMaintenance",
        {
          packageRules: [
            npm,
            nodes,
            tsgo,
            { matchManagers: ["npm"], lockFileMaintenance: { automerge: true } },
          ],
        },
        "in packageRules[3].lockFileMaintenance",
      ],
    ])("%s の automerge を拒否すること", (_name, change, where) => {
      const failures = violations(withConfig(change));
      expect(failures).toContain(outside(where));
    });

    it("automerge が false の設定は通すこと", () => {
      expect(violations(withConfig({ automerge: false, minor: { automerge: false } }))).toEqual([]);
    });

    it.each([":automergeAll", ":automergeMajor", ":automergeMinor", ":automergeLinters"])(
      "extends の %s を拒否すること",
      (preset) => {
        expect(violations(withConfig({ extends: ["config:best-practices", preset] }))).toEqual([
          `renovate.jsonc extends ${preset}, which turns on automerge outside the rules. Name the update types and managers in packageRules instead (docs/adr/0055).`,
        ]);
      },
    );

    it("automerge の preset でない extends を通すこと", () => {
      expect(violations(withConfig({ extends: ["config:best-practices"] }))).toEqual([]);
    });

    it.each(["labels", "addLabels"])("全体の %s に automerge を挙げる設定を拒否すること", (key) => {
      expect(violations(withConfig({ [key]: ["automerge"] }))).toEqual([
        'renovate.jsonc sets the label "automerge" at the top level, so it reaches the PRs a person merges. Only the rules that automerge set it (docs/tooling/renovate.md).',
      ]);
    });

    it("全体の labels に automerge 以外を挙げる設定を通すこと", () => {
      expect(violations(withConfig({ labels: ["dependencies"] }))).toEqual([]);
    });
  });

  describe("lock file の更新", () => {
    it("automerge ラベルのない lock file の更新を拒否すること", () => {
      expect(
        violations(withConfig({ lockFileMaintenance: { automerge: true, labels: [] } })),
      ).toEqual([
        'renovate.jsonc lockFileMaintenance sets automerge, so its labels must include "automerge" (docs/tooling/renovate.md).',
      ]);
    });

    it("lock file の更新を自動にしない設定は、ラベルがなくても通すこと", () => {
      expect(violations(withConfig({ lockFileMaintenance: { automerge: false } }))).toEqual([]);
    });
  });

  describe("automerge: true の規則", () => {
    it.each([
      ["matchUpdateTypes がない", undefined],
      ["matchUpdateTypes が空", []],
      ["major を含む", ["minor", "major"]],
      ["minor と patch 以外を含む", ["patch", "digest"]],
    ])("matchUpdateTypes が %s ものを拒否すること", (_name, matchUpdateTypes) => {
      expect(violations(withRules({ ...npm, matchUpdateTypes }, nodes, tsgo))).toEqual([
        `${npmRule} sets automerge, so matchUpdateTypes must list minor and patch only (docs/adr/0055).`,
      ]);
    });

    it.each([
      ["matchManagers がない", undefined],
      ["matchManagers が空", []],
      ["GitHub Actions を含む", ["npm", "github-actions"]],
      ["mise を含む", ["mise"]],
      ["custom.regex を含む", ["custom.regex"]],
    ])("%s ものを拒否すること", (_name, matchManagers) => {
      expect(violations(withRules({ ...npm, matchManagers }, nodes, tsgo))).toEqual([
        `${npmRule} sets automerge, so matchManagers must list npm only. A person merges GitHub Actions and mise tools (docs/adr/0055).`,
      ]);
    });

    it.each([
      ["matchCurrentVersion がない", undefined],
      ["0.x を除かない matchCurrentVersion", "/^1/"],
    ])("%s ものを拒否すること", (_name, matchCurrentVersion) => {
      expect(violations(withRules({ ...npm, matchCurrentVersion }, nodes, tsgo))).toEqual([
        `${npmRule} sets automerge, so matchCurrentVersion must be "!/^0/", so that a person merges a 0.x version (docs/adr/0055).`,
      ]);
    });

    it("automerge ラベルのない規則を拒否すること", () => {
      expect(violations(withRules({ ...npm, labels: ["dependencies"] }, nodes, tsgo))).toEqual([
        `${npmRule} sets automerge, so its labels must include "automerge" (docs/tooling/renovate.md).`,
      ]);
    });

    it("満たさない要求をすべて挙げること", () => {
      expect(
        violations(
          withRules(
            { description: "x", matchManagers: ["mise"], automerge: true, labels: [] },
            nodes,
            tsgo,
          ),
        ),
      ).toHaveLength(4);
    });

    it("description のない規則を、packageRules の番号で挙げること", () => {
      expect(
        violations(
          withRules({ ...npm, description: undefined, matchUpdateTypes: ["major"] }, nodes, tsgo),
        ),
      ).toEqual([
        "renovate.jsonc rule packageRules[0] sets automerge, so matchUpdateTypes must list minor and patch only (docs/adr/0055).",
      ]);
    });
  });

  describe("人が merge する依存の規則", () => {
    it.each(mergedByPerson.map((dependency) => [dependency]))(
      "%s の規則がないものを拒否すること",
      (dependency) => {
        const without = (names: unknown): unknown[] =>
          (Array.isArray(names) ? names : []).filter((name) => name !== dependency);
        expect(
          violations(
            withRules(
              npm,
              { ...nodes, matchDepNames: without(nodes?.matchDepNames) },
              { ...tsgo, matchPackageNames: without(tsgo?.matchPackageNames) },
            ),
          ),
        ).toEqual([missing(dependency)]);
      },
    );

    it("auto-merge の規則より前にある、人が merge する規則を数えないこと", () => {
      expect(violations(withRules(tsgo, nodes, npm))).toEqual(mergedByPerson.map(missing));
    });

    it("automerge を true にした規則を、人が merge する規則の代わりに数えないこと", () => {
      expect(violations(withRules(npm, { ...nodes, automerge: true }, tsgo))).toEqual([
        `${personRule} sets automerge, so matchUpdateTypes must list minor and patch only (docs/adr/0055).`,
        `${personRule} sets automerge, so matchManagers must list npm only. A person merges GitHub Actions and mise tools (docs/adr/0055).`,
        `${personRule} sets automerge, so matchCurrentVersion must be "!/^0/", so that a person merges a 0.x version (docs/adr/0055).`,
        `${personRule} sets automerge, so its labels must include "automerge" (docs/tooling/renovate.md).`,
        ...(nodes?.matchDepNames ?? []).map(missing),
      ]);
    });

    it.each([
      ["matchUpdateTypes", ["major"]],
      ["matchManagers", ["npm"]],
      ["matchCurrentVersion", "!/^0/"],
      ["matchDepTypes", ["devDependencies"]],
    ])("%s で絞った規則を、人が merge する規則として数えないこと", (matcher, value) => {
      expect(violations(withRules(npm, { ...nodes, [matcher]: value }, tsgo))).toEqual(
        (nodes?.matchDepNames ?? []).map(missing),
      );
    });

    it.each([
      ["labels がない", undefined],
      ["labels が空でない", ["automerge"]],
    ])("%s ものを拒否すること", (_name, labels) => {
      expect(violations(withRules(npm, { ...nodes, labels }, tsgo))).toEqual([
        `${personRule} sets automerge to false after the automerge rules, so it must set labels to [] and the PR does not carry "automerge" (docs/tooling/renovate.md).`,
      ]);
    });
  });

  describe("全体を止める規則 (docs/tooling/renovate.md の止め方)", () => {
    it("lockFileMaintenance を止め、labels を空にした規則を通すこと", () => {
      const stop = { matchPackageNames: ["*"], automerge: false, labels: [] };
      expect(
        violations(
          withConfig({
            lockFileMaintenance: { automerge: false },
            packageRules: [npm, nodes, tsgo, stop],
          }),
        ),
      ).toEqual([]);
    });

    it("labels を空にしない規則を拒否すること", () => {
      const stop = { matchPackageNames: ["*"], automerge: false };
      expect(violations(withRules(npm, nodes, tsgo, stop))).toEqual([
        'renovate.jsonc rule packageRules[3] sets automerge to false after the automerge rules, so it must set labels to [] and the PR does not carry "automerge" (docs/tooling/renovate.md).',
      ]);
    });
  });
});

describe("ADR 0003、0009: betterleaks の版が 1 つであること", () => {
  const violations = failuresOf(oneBetterleaks);
  it("最小の版が mise.toml のものと違う .betterleaks.toml を拒否すること", () => {
    expect(violations(repo({ "mise.toml": '[tools]\nbetterleaks = "9.9.9"\n' }))).toEqual([
      ".betterleaks.toml betterleaksMinVersion must equal the betterleaks version in mise.toml (9.9.9).",
    ]);
  });

  it.each([
    ["no betterleaks", '[tools]\nshellcheck = "0.11.0"\n'],
    ["a version that is not a string", "[tools]\nbetterleaks = 1\n"],
    ["betterleaks outside [tools]", '[env]\nbetterleaks = "1.9.0"\n'],
  ])("%s のある mise.toml を拒否すること", (_, text) => {
    expect(violations(repo({ "mise.toml": text }))).toEqual([
      "mise.toml must pin betterleaks to an exact version (docs/adr/0009).",
    ]);
  });

  it("TOML の書き方にかかわらず、版を読むこと", () => {
    const mise = "[tools]\n# pinned\n\"betterleaks\"   =   '1.9.0' # v1 only\n";
    expect(violations(repo({ "mise.toml": mise }))).toEqual([]);
  });

  it("mise.toml のないリポジトリを拒否すること", () => {
    expect(violations(repo({ "mise.toml": undefined }))).toEqual([
      "mise.toml must pin betterleaks to an exact version (docs/adr/0009).",
    ]);
  });

  it("最小の版のない .betterleaks.toml を拒否すること", () => {
    expect(
      violations(repo({ ".betterleaks.toml": "[extend]\nbetterleaksMinVersion = '1.9.0'\n" })),
    ).toEqual([
      ".betterleaks.toml betterleaksMinVersion must equal the betterleaks version in mise.toml (1.9.0).",
    ]);
  });
});

describe("steering の frontmatter (docs/knowledge/steering-authoring.md)", () => {
  const violations = failuresOf(steeringFrontmatter);
  const guide = "(docs/knowledge/steering-authoring.md)";
  const steering = (frontmatter: string) => ({
    ".kiro/steering/x.md": `---\n${frontmatter}---\n\n# X\n`,
  });

  it("各 inclusion と、1 行の配列を持つ fileMatch を通すこと", () => {
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

  it("frontmatter のないファイルを拒否すること", () => {
    expect(violations(repo({ ".kiro/steering/x.md": "no frontmatter\n" }))).toEqual([
      `.kiro/steering/x.md: must start with a frontmatter block ${guide}`,
    ]);
  });

  it("閉じていない frontmatter を拒否すること", () => {
    expect(
      violations(
        repo({ ".kiro/steering/x.md": "---\ninclusion: auto\nname: x\ndescription: d\n" }),
      ),
    ).toEqual([`.kiro/steering/x.md: frontmatter is not closed ${guide}`]);
  });

  it("欠けている、または誤っているすべての項目を挙げること", () => {
    expect(violations(repo(steering("inclusion: sometimes\nname: y\n")))).toEqual([
      `.kiro/steering/x.md: inclusion must be always, fileMatch, manual or auto ${guide}`,
      `.kiro/steering/x.md: name must be "x" ${guide}`,
      `.kiro/steering/x.md: description is required ${guide}`,
    ]);
  });

  it("空の description を拒否すること", () => {
    expect(violations(repo(steering('inclusion: auto\nname: x\ndescription: ""\n')))).toEqual([
      `.kiro/steering/x.md: description is required ${guide}`,
    ]);
  });

  it("fileMatch には fileMatchPattern を求め、fileMatch 以外には求めないこと", () => {
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
  ])("%s と書いた fileMatchPattern を拒否すること", (_, pattern) => {
    expect(
      violations(repo(steering(`inclusion: fileMatch\n${pattern}name: x\ndescription: d\n`))),
    ).toEqual([`.kiro/steering/x.md: fileMatchPattern must be a one-line array ${guide}`]);
  });

  it("有効な YAML でない frontmatter を拒否すること", () => {
    expect(
      violations(repo(steering("inclusion: auto\nname: x\ndescription: javascript: x\n"))),
    ).toEqual([
      `.kiro/steering/x.md: frontmatter is not valid YAML (Nested mappings are not allowed in compact mappings) ${guide}`,
    ]);
  });

  it("追跡されていない steering ファイルも検査すること", () => {
    expect(
      violations(repo({}, { untracked: { ".kiro/steering/broken.md": "no frontmatter\n" } })),
    ).toEqual([`.kiro/steering/broken.md: must start with a frontmatter block ${guide}`]);
  });

  it(".kiro/steering の Markdown ファイルだけを検査すること", () => {
    expect(
      violations(repo({ ".kiro/steering/notes.txt": "x\n", ".kiro/skills/a/SKILL.md": "x\n" })),
    ).toEqual([]);
  });
});

describe("別のリポジトリへの git は、シェルのラッパーからは使わないこと", () => {
  const violations = failuresOf(gitOnOtherRepositories);
  const wrapper = "tools/scripts/sh/guard-push.sh";
  const anywhere = (path: string) =>
    `${path} runs git on another repository. A shell wrapper runs git only on the repository it runs in; write a test that needs another repository in TypeScript, with gitIn (docs/adr/0024).`;

  it.each([
    ["git init", "git init -q /tmp/x"],
    ["git clone", "git clone -q a b"],
    ["git -C", 'git -C "$1" commit -m x'],
    ["--git-dir", "git --git-dir=/tmp/x/.git log"],
    ["GIT_DIR=", "GIT_DIR=/tmp/x git log"],
    ["git init at the end of a line", "cd /tmp/x && git init"],
  ])("シェルのラッパーの %s を拒否すること", (_, line) => {
    expect(violations(repo({ [wrapper]: `#!/bin/sh\n${line}\n` }))).toEqual([anywhere(wrapper)]);
  });

  it.each([
    ["a word that ends in git", "legit init"],
    ["git with another command", "git initialize"],
    ["a git command on this repository", "git rev-parse --show-toplevel"],
  ])("%s を通すこと", (_, line) => {
    expect(violations(repo({ [wrapper]: `#!/bin/sh\n${line}\n` }))).toEqual([]);
  });

  it("tools/scripts/sh/*.sh にだけ当てはめ、upstream の skill には当てはめないこと", () => {
    expect(
      violations(
        repo({
          "tools/scripts/src/checks/other.ts": "// git -C dir, git init, GIT_DIR=x\n",
          "tools/scripts/sh/nested/a.sh": "git init x\n",
          "tools/scripts/sh/other.txt": "git init x\n",
          "tools/scripts/sh/other.sh.bak": "git init x\n",
          "apps/tools/scripts/sh/other.sh": "git init x\n",
          "other/run.sh": "git init x\n",
          ".agents/skills/a/run.sh": "git init x\n",
          ".kiro/skills/a/run.sh": "git init x\n",
        }),
      ),
    ).toEqual([]);
  });
});

describe("シェルスクリプトが git で実行可能であること", () => {
  const violations = failuresOf(executableScripts);
  it("index の mode が 100755 でないシェルスクリプトを拒否すること", () => {
    const path = "tools/scripts/sh/guard-push.sh";
    expect(violations(repo({}, { modes: { [path]: "100644" } }))).toEqual([
      `${path} is not executable in git. Run \`chmod +x ${path}\` and stage it again.`,
    ]);
  });

  it("tools/scripts/sh/*.sh だけを検査し、upstream の skill は検査しないこと", () => {
    const paths = [".agents/skills/a/x.sh", ".kiro/skills/a/x.sh", "other/x.sh"];
    const files = Object.fromEntries(paths.map((path) => [path, "x\n"]));
    const modes = Object.fromEntries(paths.map((path) => [path, "100644"]));
    expect(violations(repo(files, { modes }))).toEqual([]);
  });
});

describe("すべてのシェルのラッパーにプロセスのテストがあること", () => {
  const violations = failuresOf(shellScriptsHaveTests);
  const path = "tools/scripts/sh/other.sh";
  const test = "tools/scripts/src/sh/other.test.ts";
  const missing = `${path} has no process test. Write ${test}, with a stub tool from src/test/stubs.ts that checks what the script hands to the tool and its exit code (docs/tooling/ci.md, "検査を足すとき" の 5).`;

  it("src/sh/<name>.test.ts のないラッパーを拒否すること", () => {
    expect(violations(repo({ [path]: "#!/bin/sh\ntrue\n" }))).toEqual([missing]);
  });

  it("テストのあるラッパーを通すこと", () => {
    expect(violations(repo({ [path]: "#!/bin/sh\ntrue\n", [test]: "// test\n" }))).toEqual([]);
  });

  it("本物の道具のテストを、プロセスのテストと取り違えないこと", () => {
    const tools = "tools/scripts/src/sh/other.tools.test.ts";
    expect(violations(repo({ [path]: "#!/bin/sh\ntrue\n", [tools]: "// test\n" }))).toEqual([
      missing,
    ]);
  });

  it("tools/scripts/sh/*.sh だけを検査し、upstream の skill は検査しないこと", () => {
    expect(violations(repo({ ".agents/skills/a/run.sh": "x\n", "other/run.sh": "x\n" }))).toEqual(
      [],
    );
  });
});

describe("ADR 0013: Node.js のメジャーバージョンが 1 つであること", () => {
  const violations = failuresOf(oneNodeMajor);
  it.each(["v24.1.2\n", "24\n", "24.22.1\n\n# comment\n", "\n# pinned\n24.22.1\n"])(
    "%j の .node-version を通すこと",
    (version) => {
      expect(violations(repo({ ".node-version": version }))).toEqual([]);
    },
  );

  it("単独で動く .node-version を拒否すること", () => {
    expect(violations(repo({ ".node-version": "25\n" }))).toEqual([
      "package.json engines.node (24) must be Node.js 25, the major of .node-version (docs/adr/0013).",
      "pnpm-workspace.yaml catalog @types/node (24) must be Node.js 25, the major of .node-version (docs/adr/0013).",
      "apps/api/vite.config.ts builds for node24, but .node-version is Node.js 25 (docs/adr/0013).",
    ]);
  });

  it.each(["lts\n", "", undefined])("%j の .node-version を拒否すること", (version) => {
    expect(violations(repo({ ".node-version": version }))).toEqual([
      ".node-version must start with a Node.js version such as 24 or 24.22.1 (docs/adr/0013).",
    ]);
  });

  it("別のメジャーの engines.node を拒否し、読めないものを挙げること", () => {
    expect(violations(repo({ "package.json": json({ engines: { node: ">=25" } }) }))).toEqual([
      "package.json engines.node (25) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
    expect(violations(repo({ "package.json": json({}) }))).toEqual([
      "package.json engines.node (unreadable) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
  });

  it("別のメジャーの @types/node の catalog を拒否し、読めないものを挙げること", () => {
    expect(
      violations(repo({ "pnpm-workspace.yaml": 'catalog:\n  "@types/node": 25.0.1\n' })),
    ).toEqual([
      "pnpm-workspace.yaml catalog @types/node (25) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
    expect(violations(repo({ "pnpm-workspace.yaml": "packages: []\n" }))).toEqual([
      "pnpm-workspace.yaml catalog @types/node (unreadable) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
  });

  it("YAML の書き方にかかわらず、catalog を読むこと", () => {
    const flow = 'catalog: { "@types/node": "~24.3.0" }\n';
    expect(violations(repo({ "pnpm-workspace.yaml": flow }))).toEqual([]);
  });

  it("どの vite.config.ts でも、別のメジャーの build target を拒否すること", () => {
    expect(
      violations(
        repo({ "apps/web/vite.config.ts": 'export default { build: { target: "node25" } };\n' }),
      ),
    ).toEqual([
      "apps/web/vite.config.ts builds for node25, but .node-version is Node.js 24 (docs/adr/0013).",
    ]);
  });
});

describe("compose.local.yaml と postgresImage の PostgreSQL の版が 1 つであること (#515)", () => {
  const violations = failuresOf(onePostgresVersion);
  const connection = "packages/db/src/testing/connection.ts";
  const compose = (image: string): string => `services:\n  postgres:\n    image: ${image}\n`;

  // The passing repo's compose has a digest after the tag; this case has none.
  it("digest のない compose の tag を通すこと", () => {
    expect(violations(repo({ "compose.local.yaml": compose("postgres:18") }))).toEqual([]);
  });

  it.each([
    ["no space", 'export const postgresImage="postgres:18";\n'],
    ["many spaces", 'export const postgresImage   =   "postgres:18";\n'],
  ])("等号の前後に %s のある postgresImage を読むこと", (_, text) => {
    expect(violations(repo({ [connection]: text }))).toEqual([]);
  });

  it("単独で動く compose と、単独で動く postgresImage を拒否すること", () => {
    expect(violations(repo({ "compose.local.yaml": compose("postgres:19@sha256:abc") }))).toEqual([
      `compose.local.yaml postgres image (postgres:19) must be the tag of postgresImage in ${connection} (postgres:18) (docs/tooling/local-worker.md).`,
    ]);
    expect(
      violations(repo({ [connection]: 'export const postgresImage = "postgres:17";\n' })),
    ).toEqual([
      `compose.local.yaml postgres image (postgres:18) must be the tag of postgresImage in ${connection} (postgres:17) (docs/tooling/local-worker.md).`,
    ]);
  });

  it("postgres の image のない compose と、リテラルでない postgresImage を挙げること", () => {
    expect(violations(repo({ "compose.local.yaml": "services: {}\n" }))).toEqual([
      "compose.local.yaml must set services.postgres.image (docs/tooling/local-worker.md).",
    ]);
    expect(violations(repo({ [connection]: "export const postgresImage = image;\n" }))).toEqual([
      `${connection} must set postgresImage to a string literal (docs/tooling/local-worker.md).`,
    ]);
  });
});

describe("ADR 番号が一意であること", () => {
  const violations = failuresOf(uniqueAdrNumbers);
  it("同じ番号の 2 つの ADR を拒否すること", () => {
    expect(violations(repo({ "docs/adr/0001-duplicate.md": "# x\n" }))).toEqual([
      "ADR 0001 is used by more than one file: docs/adr/0001-duplicate.md docs/adr/0001-lefthook.md",
    ]);
  });

  it("ADR でないファイルを数えないこと", () => {
    expect(
      violations(repo({ "docs/adr/index.md": "# x\n", "docs/adr/0001/notes.md": "# x\n" })),
    ).toEqual([]);
  });
});

describe("ADR 0025: migration が前にだけ進むこと", () => {
  const violations = failuresOf(migrationsGoForward);
  const path = "packages/db/migrations/20260102000000_add_y.sql";
  const downProblem = `${path} has a down section that is not only \`DO $$ BEGIN RAISE EXCEPTION '...'; END $$;\`. Migrations go forward only (docs/adr/0025).`;
  const lockProblem = `${path} does not start its up section with SET LOCAL lock_timeout. Add it, or mark the file transaction:false (docs/adr/0025).`;

  it("raise する down と lock_timeout を持つ migration を通すこと", () => {
    expect(violations(repo({ [path]: migration() }))).toEqual([]);
  });

  it("文の前後のコメントと、小文字の down を通すこと", () => {
    expect(
      violations(
        repo({
          [path]: migration({
            up: "-- why\nset local lock_timeout = '3s';\nALTER TABLE x ADD COLUMN y int;\n",
            down: "-- irreversible\ndo $$ begin raise exception 'no'; end $$;\n",
          }),
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["an empty down", ""],
    ["a down with only a comment", "-- nothing\n"],
    ["a down that drops the table", "DROP TABLE x;\n"],
    [
      "a down that raises and then drops",
      "DO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\nDROP TABLE x;\n",
    ],
    ["a down that does something else in the block", "DO $$ BEGIN DROP TABLE x; END $$;\n"],
  ])("%s を拒否すること", (_name, down) => {
    expect(violations(repo({ [path]: migration({ down }) }))).toEqual([downProblem]);
  });

  it("down の節のない migration を拒否すること", () => {
    expect(
      violations(
        repo({
          [path]: "-- migrate:up\nSET LOCAL lock_timeout = '5s';\nCREATE TABLE y (id int);\n",
        }),
      ),
    ).toEqual([downProblem]);
  });

  it("SET LOCAL lock_timeout で始まらない up の節を拒否すること", () => {
    expect(
      violations(
        repo({
          [path]: migration({ up: "CREATE TABLE y (id int);\nSET LOCAL lock_timeout = '5s';\n" }),
        }),
      ),
    ).toEqual([lockProblem]);
  });

  it("空の up の節を拒否すること", () => {
    expect(violations(repo({ [path]: migration({ up: "" }) }))).toEqual([lockProblem]);
  });

  it("transaction:false のファイルには lock_timeout を求めないこと", () => {
    expect(
      violations(
        repo({
          [path]: migration({
            upOptions: " transaction:false",
            up: "CREATE INDEX CONCURRENTLY y_idx ON x (id);\n",
          }),
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["a statement before the block", "SELECT 1;\nDO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\n"],
    ["a statement after the block", "DO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\nSELECT 1;\n"],
    ["a block that raises with an empty message", "DO $$ BEGIN RAISE EXCEPTION ''; END $$;\n"],
  ])("%s のある down を拒否すること", (_name, down) => {
    expect(violations(repo({ [path]: migration({ down }) }))).toEqual([downProblem]);
  });

  it.each([
    ["written compactly, without the last semicolon", "DO $$BEGIN RAISE EXCEPTION 'x';END$$"],
    [
      "written over several lines with wide spacing",
      "DO   $$\n  BEGIN\n\tRAISE   EXCEPTION   'x'   ;\n  END   $$   ;\n",
    ],
    ["with a `--` inside the message", "DO $$ BEGIN RAISE EXCEPTION 'a -- b'; END $$;\n"],
  ])("down %s を通すこと", (_name, down) => {
    expect(violations(repo({ [path]: migration({ down }) }))).toEqual([]);
  });

  it.each([
    ["spaces", "SET   LOCAL   lock_timeout = '5s';\n"],
    ["lines", "SET\nLOCAL\nlock_timeout = '5s';\n"],
    ["an indented comment before it", "  -- why\n\t-- and why\nSET LOCAL lock_timeout = '5s';\n"],
    [
      "a comment that mentions the marker",
      "-- run it -- migrate: later\nSET LOCAL lock_timeout = '5s';\n",
    ],
  ])("%s のある up の節を通すこと", (_name, up) => {
    expect(violations(repo({ [path]: migration({ up }) }))).toEqual([]);
  });

  it("down の節ではなく、up の節の lock_timeout を読むこと", () => {
    expect(
      violations(repo({ [path]: migration({ up: "", down: "SET LOCAL lock_timeout = '5s';\n" }) })),
    ).toEqual([downProblem, lockProblem]);
  });

  it("down の節の後ろにある up の節を、最後の文字まで読むこと", () => {
    const sql =
      "-- migrate:down\nDO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\n-- migrate:up\nSET LOCAL lock_timeout";
    expect(violations(repo({ [path]: sql }))).toEqual([]);
  });

  it("up の節のない migration を拒否すること", () => {
    const sql = "-- migrate:down\nDO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\n";
    expect(violations(repo({ [path]: sql }))).toEqual([lockProblem]);
  });

  it("別の単語でしかない transaction:false を拒否すること", () => {
    expect(
      violations(
        repo({ [path]: migration({ upOptions: " transaction:falsy", up: "SELECT 1;\n" }) }),
      ),
    ).toEqual([lockProblem]);
  });

  it("リポジトリのルートの migration を検査し、先頭だけが似たファイルを検査しないこと", () => {
    expect(
      violations(repo({ "db/migrations/20260104000000_w.sql": "", "db/migrations/x.sql.bak": "" })),
    ).toEqual([
      `db/migrations/20260104000000_w.sql has a down section that is not only \`DO $$ BEGIN RAISE EXCEPTION '...'; END $$;\`. Migrations go forward only (docs/adr/0025).`,
      "db/migrations/20260104000000_w.sql does not start its up section with SET LOCAL lock_timeout. Add it, or mark the file transaction:false (docs/adr/0025).",
    ]);
  });

  it("1 つのファイルの 2 つの問題と、別のモジュールのファイルを報告すること", () => {
    const other = "packages/claim/db/migrations/20260103000000_z.sql";
    expect(
      violations(repo({ [path]: migration({ up: "SELECT 1;\n", down: "" }), [other]: "" })),
    ).toEqual([
      `${other} has a down section that is not only \`DO $$ BEGIN RAISE EXCEPTION '...'; END $$;\`. Migrations go forward only (docs/adr/0025).`,
      `${other} does not start its up section with SET LOCAL lock_timeout. Add it, or mark the file transaction:false (docs/adr/0025).`,
      downProblem,
      lockProblem,
    ]);
  });

  it("db/migrations の外のファイルと、SQL でないファイルを読まないこと", () => {
    expect(
      violations(
        repo({
          "packages/db/bootstrap.sql": "SELECT 1;\n",
          "packages/db/migrations/README.md": "",
          "docs/migrations/x.sql": "",
        }),
      ),
    ).toEqual([]);
  });
});

describe("pnpm の catalog に workspace の package がないこと", () => {
  const violations = failuresOf(noWorkspaceInCatalog);
  const refused = (where: string, name: string) =>
    `pnpm-workspace.yaml ${where} has ${name}: workspace:*. A workspace package is not a catalog entry: write "workspace:*" in the package.json that depends on it and run pnpm install. With catalogMode: prefer, \`pnpm add <package>@workspace:*\` puts it in the catalog.`;

  it("既定の catalog の workspace: の版を拒否すること", () => {
    const workspace = `${base["pnpm-workspace.yaml"] ?? ""}  "@x/shared": workspace:*\n`;
    expect(violations(repo({ "pnpm-workspace.yaml": workspace }))).toEqual([
      refused("catalog", "@x/shared"),
    ]);
  });

  it("文字列でない版を通すこと", () => {
    const workspace = `${base["pnpm-workspace.yaml"] ?? ""}  "@x/number": 1\n`;
    expect(violations(repo({ "pnpm-workspace.yaml": workspace }))).toEqual([]);
  });

  it("名前つき catalog の workspace: の版を拒否すること", () => {
    const workspace = `${base["pnpm-workspace.yaml"] ?? ""}catalogs:\n  tools:\n    "@x/shared": workspace:^\n`;
    expect(violations(repo({ "pnpm-workspace.yaml": workspace }))).toEqual([
      refused("catalogs.tools", "@x/shared").replace("workspace:*.", "workspace:^."),
    ]);
  });
});

// The edges of nxRunsTasks: inputs just inside and just outside what it matches.
describe("ADR 0002: 辺", () => {
  const violations = failuresOf(nxRunsTasks);
  it("ルートの package.json の @nx/vite を拒否すること", () => {
    const root = json({ engines: { node: "^24" }, devDependencies: { "@nx/vite": "24.0.0" } });
    expect(violations(repo({ "package.json": root }))).toEqual([
      "package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
    ]);
  });

  // check-repo-policy.sh grepped the whole package.json for "@nx/vite".
  it.each([
    ["overrides", { overrides: { "@nx/vite": "-" } }],
    ["resolutions", { resolutions: { "@nx/vite": "-" } }],
    ["pnpm.overrides", { pnpm: { overrides: { "@nx/vite": "-" } } }],
    ["a list", { pnpm: { packageExtensions: [{}, { x: { "@nx/vite": "-" } }] } }],
  ])("%s のキーとしての @nx/vite を拒否すること", (_, manifest) => {
    expect(violations(repo({ "apps/api/package.json": apiManifest(manifest) }))).toEqual([
      "apps/api/package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
    ]);
  });

  it("null の dependency の項目を通すこと", () => {
    expect(
      violations(
        repo({
          "apps/api/package.json": apiManifest({
            devDependencies: null,
            peerDependencies: null,
            optionalDependencies: null,
          }),
        }),
      ),
    ).toEqual([]);
  });

  it("コロンの前に空白のある run ブロックを拒否すること", () => {
    const config = `${base["vite.config.ts"] ?? ""}  run  : {}\n`;
    expect(violations(repo({ "vite.config.ts": config }))).toEqual([
      "vite.config.ts has a `run` block. Task running and caching belong to Nx (docs/adr/0002).",
    ]);
  });

  it("設定のより深くに入れ子になった run キーを通すこと", () => {
    const nested = "export default {\n  test: {\n    run: 1,\n  },\n};\n";
    expect(violations(repo({ "apps/web/vite.config.ts": nested }))).toEqual([]);
  });
});

describe("steering の frontmatter: 辺", () => {
  const violations = failuresOf(steeringFrontmatter);
  const guide = "(docs/knowledge/steering-authoring.md)";

  it("ファイルをその名前全体で挙げること", () => {
    expect(violations(repo({ ".kiro/steering/long-name.md": "no frontmatter\n" }))).toEqual([
      `.kiro/steering/long-name.md: must start with a frontmatter block ${guide}`,
    ]);
  });

  it.each(['" "', "1"])("%s の description を拒否すること", (description) => {
    const text = `---\ninclusion: auto\nname: x\ndescription: ${description}\n---\n`;
    expect(violations(repo({ ".kiro/steering/x.md": text }))).toEqual([
      `.kiro/steering/x.md: description is required ${guide}`,
    ]);
  });

  // The untracked files come from the pathspec .kiro/steering/*.md, whose * matches / too (gitglossary(7)).
  it("追跡されていない steering ファイルに pathspec がするのと同じく、どの深さでも追跡された steering ファイルを検査すること", () => {
    expect(violations(repo({ ".kiro/steering/sub/y.md": "x\n" }))).toEqual([
      `.kiro/steering/sub/y.md: must start with a frontmatter block ${guide}`,
    ]);
  });

  it("steering に見えるだけのほかのファイルを検査しないこと", () => {
    expect(
      violations(
        repo({
          ".kiro/steering/old.md.bak": "x\n",
          ".kiro/steeringx.md": "x\n",
          "apps/.kiro/steering/x.md": "x\n",
        }),
      ),
    ).toEqual([]);
  });
});

describe("別のリポジトリへの git: 辺", () => {
  const violations = failuresOf(gitOnOtherRepositories);
  const wrapper = "tools/scripts/sh/guard-push.sh";
  const anywhere = (path: string) =>
    `${path} runs git on another repository. A shell wrapper runs git only on the repository it runs in; write a test that needs another repository in TypeScript, with gitIn (docs/adr/0024).`;

  it.each([
    ["git and init apart", "#!/bin/sh\ngit  init x\n"],
    ["git and -C apart", "#!/bin/sh\ngit  -C x log\n"],
    ["git at the start of the file", "git clone a b\n"],
    ["git init at the end of the file", "#!/bin/sh\ngit init"],
  ])("%s を拒否すること", (_, text) => {
    expect(violations(repo({ [wrapper]: text }))).toEqual([anywhere(wrapper)]);
  });

  // check-repo-policy.sh grepped line by line, so a match never spans two lines.
  it.each([
    ["git and init", "echo git\ninit x\n"],
    ["git and -C", "echo git\n-C x\n"],
    ["-C and its argument", "git -C\nx\n"],
  ])("別の行に書かれた %s を通すこと", (_, text) => {
    expect(violations(repo({ [wrapper]: `#!/bin/sh\n${text}` }))).toEqual([]);
  });
});

describe("ADR 0013: 辺", () => {
  const violations = failuresOf(oneNodeMajor);
  it("版で始まらない .node-version を拒否すること", () => {
    expect(violations(repo({ ".node-version": "lts-24\n" }))).toEqual([
      ".node-version must start with a Node.js version such as 24 or 24.22.1 (docs/adr/0013).",
    ]);
  });

  it("YAML が数値と読む @types/node の catalog の項目を読むこと", () => {
    expect(violations(repo({ "pnpm-workspace.yaml": 'catalog:\n  "@types/node": 24\n' }))).toEqual(
      [],
    );
  });

  it.each([["latest"], [["24"]], [{ major: 24 }]])(
    "%j の engines.node を読めないと挙げること",
    (node) => {
      expect(violations(repo({ "package.json": json({ engines: { node } }) }))).toEqual([
        "package.json engines.node (unreadable) must be Node.js 24, the major of .node-version (docs/adr/0013).",
      ]);
    },
  );

  it("空白なしで書いた build target を読むこと", () => {
    const config = 'export default { build: { target:"node25" } };\n';
    expect(violations(repo({ "apps/web/vite.config.ts": config }))).toEqual([
      "apps/web/vite.config.ts builds for node25, but .node-version is Node.js 24 (docs/adr/0013).",
    ]);
  });
});

describe("ADR 番号: 辺", () => {
  const violations = failuresOf(uniqueAdrNumbers);
  it("ADR に見えるだけのファイルを数えないこと", () => {
    expect(
      violations(repo({ "docs/adr/0001-old.md.bak": "# x\n", "apps/docs/adr/0001-a.md": "# x\n" })),
    ).toEqual([]);
  });
});
