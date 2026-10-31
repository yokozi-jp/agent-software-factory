// The checks of tool settings and repository files (./tooling.ts), each called on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { apiDependencies, migration, passingRepo } from "./fixtures/passing-repo.ts";
import { apiManifest, failuresOf, json, repo } from "./fixtures/repo.ts";
import {
  executableScripts,
  gitOnOtherRepositories,
  lefthookOwnsHooks,
  migrationsGoForward,
  noWorkspaceInCatalog,
  nxRunsTasks,
  oneBetterleaks,
  oneNodeMajor,
  onePostgresVersion,
  shellScriptsHaveTests,
  steeringFrontmatter,
  uniqueAdrNumbers,
} from "./tooling.ts";

const base = passingRepo;

describe("ADR 0002: Nx runs the tasks", () => {
  const violations = failuresOf(nxRunsTasks);
  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "refuses @nx/vite in %s of any package.json",
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

  it("passes a package.json that names @nx/vite outside its dependencies", () => {
    expect(
      violations(repo({ "apps/api/package.json": apiManifest({ description: "not @nx/vite" }) })),
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
  const violations = failuresOf(lefthookOwnsHooks);
  const message = ".vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001).";

  it("refuses a .vite-hooks directory in the working tree", () => {
    expect(violations(repo({}, { viteHooks: true }))).toEqual([message]);
  });

  it("refuses a tracked file in .vite-hooks", () => {
    expect(violations(repo({ ".vite-hooks/pre-commit": "x\n" }))).toEqual([message]);
  });
});

describe("ADR 0003, 0009: one betterleaks version", () => {
  const violations = failuresOf(oneBetterleaks);
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

describe("steering frontmatter (docs/knowledge/steering-authoring.md)", () => {
  const violations = failuresOf(steeringFrontmatter);
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

  it("checks only the Markdown files in .kiro/steering", () => {
    expect(
      violations(repo({ ".kiro/steering/notes.txt": "x\n", ".kiro/skills/a/SKILL.md": "x\n" })),
    ).toEqual([]);
  });
});

describe("git on another repository, never from a shell wrapper", () => {
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
  ])("refuses %s in a shell wrapper", (_, line) => {
    expect(violations(repo({ [wrapper]: `#!/bin/sh\n${line}\n` }))).toEqual([anywhere(wrapper)]);
  });

  it.each([
    ["a word that ends in git", "legit init"],
    ["git with another command", "git initialize"],
    ["a git command on this repository", "git rev-parse --show-toplevel"],
  ])("passes %s", (_, line) => {
    expect(violations(repo({ [wrapper]: `#!/bin/sh\n${line}\n` }))).toEqual([]);
  });

  it("applies only to tools/scripts/sh/*.sh, and not to the upstream skills", () => {
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

describe("shell scripts are executable in git", () => {
  const violations = failuresOf(executableScripts);
  it("refuses a shell script whose index mode is not 100755", () => {
    const path = "tools/scripts/sh/guard-push.sh";
    expect(violations(repo({}, { modes: { [path]: "100644" } }))).toEqual([
      `${path} is not executable in git. Run \`chmod +x ${path}\` and stage it again.`,
    ]);
  });

  it("checks only tools/scripts/sh/*.sh, so not the upstream skills", () => {
    const paths = [".agents/skills/a/x.sh", ".kiro/skills/a/x.sh", "other/x.sh"];
    const files = Object.fromEntries(paths.map((path) => [path, "x\n"]));
    const modes = Object.fromEntries(paths.map((path) => [path, "100644"]));
    expect(violations(repo(files, { modes }))).toEqual([]);
  });
});

describe("every shell wrapper has a process test", () => {
  const violations = failuresOf(shellScriptsHaveTests);
  const path = "tools/scripts/sh/other.sh";
  const test = "tools/scripts/src/sh/other.test.ts";
  const missing = `${path} has no process test. Write ${test}, with a stub tool from src/test/stubs.ts that checks what the script hands to the tool and its exit code (docs/tooling/ci.md, "検査を足すとき" の 5).`;

  it("refuses a wrapper with no src/sh/<name>.test.ts", () => {
    expect(violations(repo({ [path]: "#!/bin/sh\ntrue\n" }))).toEqual([missing]);
  });

  it("passes a wrapper with its test", () => {
    expect(violations(repo({ [path]: "#!/bin/sh\ntrue\n", [test]: "// test\n" }))).toEqual([]);
  });

  it("does not take the test of the real tool for the process test", () => {
    const tools = "tools/scripts/src/sh/other.tools.test.ts";
    expect(violations(repo({ [path]: "#!/bin/sh\ntrue\n", [tools]: "// test\n" }))).toEqual([
      missing,
    ]);
  });

  it("checks only tools/scripts/sh/*.sh, so not the upstream skills", () => {
    expect(violations(repo({ ".agents/skills/a/run.sh": "x\n", "other/run.sh": "x\n" }))).toEqual(
      [],
    );
  });
});

describe("ADR 0013: one Node.js major version", () => {
  const violations = failuresOf(oneNodeMajor);
  it.each(["v24.1.2\n", "24\n", "24.22.1\n\n# comment\n", "\n# pinned\n24.22.1\n"])(
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

describe("one PostgreSQL version in compose.local.yaml and postgresImage (#515)", () => {
  const violations = failuresOf(onePostgresVersion);
  const connection = "packages/db/src/testing/connection.ts";
  const compose = (image: string): string => `services:\n  postgres:\n    image: ${image}\n`;

  // The passing repo's compose has a digest after the tag; this case has none.
  it("passes a compose tag without a digest", () => {
    expect(violations(repo({ "compose.local.yaml": compose("postgres:18") }))).toEqual([]);
  });

  it("refuses a compose that moves alone, and a postgresImage that moves alone", () => {
    expect(violations(repo({ "compose.local.yaml": compose("postgres:19@sha256:abc") }))).toEqual([
      `compose.local.yaml postgres image (postgres:19) must be the tag of postgresImage in ${connection} (postgres:18) (docs/tooling/local-worker.md).`,
    ]);
    expect(
      violations(repo({ [connection]: 'export const postgresImage = "postgres:17";\n' })),
    ).toEqual([
      `compose.local.yaml postgres image (postgres:18) must be the tag of postgresImage in ${connection} (postgres:17) (docs/tooling/local-worker.md).`,
    ]);
  });

  it("names a compose without the postgres image, and a postgresImage that is not a literal", () => {
    expect(violations(repo({ "compose.local.yaml": "services: {}\n" }))).toEqual([
      "compose.local.yaml must set services.postgres.image (docs/tooling/local-worker.md).",
    ]);
    expect(violations(repo({ [connection]: "export const postgresImage = image;\n" }))).toEqual([
      `${connection} must set postgresImage to a string literal (docs/tooling/local-worker.md).`,
    ]);
  });
});

describe("ADR numbers are unique", () => {
  const violations = failuresOf(uniqueAdrNumbers);
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

describe("ADR 0025: migrations go forward only", () => {
  const violations = failuresOf(migrationsGoForward);
  const path = "packages/db/migrations/20260102000000_add_y.sql";
  const downProblem = `${path} has a down section that is not only \`DO $$ BEGIN RAISE EXCEPTION '...'; END $$;\`. Migrations go forward only (docs/adr/0025).`;
  const lockProblem = `${path} does not start its up section with SET LOCAL lock_timeout. Add it, or mark the file transaction:false (docs/adr/0025).`;

  it("passes a migration with a raising down and a lock_timeout", () => {
    expect(violations(repo({ [path]: migration() }))).toEqual([]);
  });

  it("passes comments around the statements and a lower-case down", () => {
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
  ])("refuses %s", (_name, down) => {
    expect(violations(repo({ [path]: migration({ down }) }))).toEqual([downProblem]);
  });

  it("refuses a migration without a down section", () => {
    expect(
      violations(
        repo({
          [path]: "-- migrate:up\nSET LOCAL lock_timeout = '5s';\nCREATE TABLE y (id int);\n",
        }),
      ),
    ).toEqual([downProblem]);
  });

  it("refuses an up section that does not start with SET LOCAL lock_timeout", () => {
    expect(
      violations(
        repo({
          [path]: migration({ up: "CREATE TABLE y (id int);\nSET LOCAL lock_timeout = '5s';\n" }),
        }),
      ),
    ).toEqual([lockProblem]);
  });

  it("refuses an up section that is empty", () => {
    expect(violations(repo({ [path]: migration({ up: "" }) }))).toEqual([lockProblem]);
  });

  it("does not ask a transaction:false file for lock_timeout", () => {
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
  ])("refuses a down with %s", (_name, down) => {
    expect(violations(repo({ [path]: migration({ down }) }))).toEqual([downProblem]);
  });

  it.each([
    ["written compactly, without the last semicolon", "DO $$BEGIN RAISE EXCEPTION 'x';END$$"],
    [
      "written over several lines with wide spacing",
      "DO   $$\n  BEGIN\n\tRAISE   EXCEPTION   'x'   ;\n  END   $$   ;\n",
    ],
    ["with a `--` inside the message", "DO $$ BEGIN RAISE EXCEPTION 'a -- b'; END $$;\n"],
  ])("passes a down %s", (_name, down) => {
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
  ])("passes an up section with %s", (_name, up) => {
    expect(violations(repo({ [path]: migration({ up }) }))).toEqual([]);
  });

  it("reads the lock_timeout of the up section, not the one in the down section", () => {
    expect(
      violations(repo({ [path]: migration({ up: "", down: "SET LOCAL lock_timeout = '5s';\n" }) })),
    ).toEqual([downProblem, lockProblem]);
  });

  it("reads an up section that comes after the down section, to the last character", () => {
    const sql =
      "-- migrate:down\nDO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\n-- migrate:up\nSET LOCAL lock_timeout";
    expect(violations(repo({ [path]: sql }))).toEqual([]);
  });

  it("refuses a migration without an up section", () => {
    const sql = "-- migrate:down\nDO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\n";
    expect(violations(repo({ [path]: sql }))).toEqual([lockProblem]);
  });

  it("refuses transaction:false that is only another word", () => {
    expect(
      violations(
        repo({ [path]: migration({ upOptions: " transaction:falsy", up: "SELECT 1;\n" }) }),
      ),
    ).toEqual([lockProblem]);
  });

  it("checks a migration at the root of the repository, not a file that only starts like one", () => {
    expect(
      violations(repo({ "db/migrations/20260104000000_w.sql": "", "db/migrations/x.sql.bak": "" })),
    ).toEqual([
      `db/migrations/20260104000000_w.sql has a down section that is not only \`DO $$ BEGIN RAISE EXCEPTION '...'; END $$;\`. Migrations go forward only (docs/adr/0025).`,
      "db/migrations/20260104000000_w.sql does not start its up section with SET LOCAL lock_timeout. Add it, or mark the file transaction:false (docs/adr/0025).",
    ]);
  });

  it("reports both problems of one file, and the file of another module", () => {
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

  it("does not read files outside db/migrations, or that are not SQL", () => {
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

describe("the pnpm catalog has no workspace packages", () => {
  const violations = failuresOf(noWorkspaceInCatalog);
  const refused = (where: string, name: string) =>
    `pnpm-workspace.yaml ${where} has ${name}: workspace:*. A workspace package is not a catalog entry: write "workspace:*" in the package.json that depends on it and run pnpm install. With catalogMode: prefer, \`pnpm add <package>@workspace:*\` puts it in the catalog.`;

  it("refuses a workspace: version in the default catalog", () => {
    const workspace = `${base["pnpm-workspace.yaml"] ?? ""}  "@x/shared": workspace:*\n`;
    expect(violations(repo({ "pnpm-workspace.yaml": workspace }))).toEqual([
      refused("catalog", "@x/shared"),
    ]);
  });

  it("passes a version that is not a string", () => {
    const workspace = `${base["pnpm-workspace.yaml"] ?? ""}  "@x/number": 1\n`;
    expect(violations(repo({ "pnpm-workspace.yaml": workspace }))).toEqual([]);
  });

  it("refuses a workspace: version in a named catalog", () => {
    const workspace = `${base["pnpm-workspace.yaml"] ?? ""}catalogs:\n  tools:\n    "@x/shared": workspace:^\n`;
    expect(violations(repo({ "pnpm-workspace.yaml": workspace }))).toEqual([
      refused("catalogs.tools", "@x/shared").replace("workspace:*.", "workspace:^."),
    ]);
  });
});

// The edges of each check: inputs just inside and just outside what it matches.
describe("ADR 0002: the edges", () => {
  const violations = failuresOf(nxRunsTasks);
  it("refuses @nx/vite in the root package.json", () => {
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
  ])("refuses @nx/vite as a key in %s", (_, manifest) => {
    expect(violations(repo({ "apps/api/package.json": apiManifest(manifest) }))).toEqual([
      "apps/api/package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
    ]);
  });

  it("passes dependency fields that are null", () => {
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
  const violations = failuresOf(steeringFrontmatter);
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

  // The untracked files come from the pathspec .kiro/steering/*.md, whose * matches / too (gitglossary(7)).
  it("checks tracked steering files at any depth, as the pathspec does for untracked ones", () => {
    expect(violations(repo({ ".kiro/steering/sub/y.md": "x\n" }))).toEqual([
      `.kiro/steering/sub/y.md: must start with a frontmatter block ${guide}`,
    ]);
  });

  it("does not check other files that look like steering", () => {
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

describe("git on another repository: the edges", () => {
  const violations = failuresOf(gitOnOtherRepositories);
  const wrapper = "tools/scripts/sh/guard-push.sh";
  const anywhere = (path: string) =>
    `${path} runs git on another repository. A shell wrapper runs git only on the repository it runs in; write a test that needs another repository in TypeScript, with gitIn (docs/adr/0024).`;

  it.each([
    ["git and init apart", "#!/bin/sh\ngit  init x\n"],
    ["git and -C apart", "#!/bin/sh\ngit  -C x log\n"],
    ["git at the start of the file", "git clone a b\n"],
    ["git init at the end of the file", "#!/bin/sh\ngit init"],
  ])("refuses %s", (_, text) => {
    expect(violations(repo({ [wrapper]: text }))).toEqual([anywhere(wrapper)]);
  });

  // check-repo-policy.sh grepped line by line, so a match never spans two lines.
  it.each([
    ["git and init", "echo git\ninit x\n"],
    ["git and -C", "echo git\n-C x\n"],
    ["-C and its argument", "git -C\nx\n"],
  ])("passes %s on separate lines", (_, text) => {
    expect(violations(repo({ [wrapper]: `#!/bin/sh\n${text}` }))).toEqual([]);
  });
});

describe("ADR 0013: the edges", () => {
  const violations = failuresOf(oneNodeMajor);
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
  const violations = failuresOf(uniqueAdrNumbers);
  it("does not count files that only look like ADRs", () => {
    expect(
      violations(repo({ "docs/adr/0001-old.md.bak": "# x\n", "apps/docs/adr/0001-a.md": "# x\n" })),
    ).toEqual([]);
  });
});
