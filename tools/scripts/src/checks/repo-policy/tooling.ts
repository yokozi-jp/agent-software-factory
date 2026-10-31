// Checks of the tool settings and repository files: Nx, lefthook, betterleaks, Node.js, steering, shell scripts, ADR numbers, migrations, the pnpm catalog.
import { isSeq, parseDocument } from "yaml";
import { Tree, hasKey, record } from "./tree.ts";

// ADR 0002: Nx runs tasks; Vite+ is toolchain only.
// @nx/vite anywhere in a package.json counts: the dependencies, and also overrides, resolutions and
// pnpm.overrides.
export function nxRunsTasks(tree: Tree): string[] {
  const failures: string[] = [];
  for (const manifest of tree.named("package.json"))
    if (hasKey(tree.parsed(manifest), "@nx/vite"))
      failures.push(
        `${manifest} depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).`,
      );
  // A `run` key two spaces in: a key of the object passed to defineConfig. This repository formats
  // vite.config.ts with vp fmt (Oxfmt) and sets no indentation, so it indents by Oxfmt's default of two
  // spaces (Oxfmt config file reference, `tabWidth`, `useTabs`).
  for (const config of tree.named("vite.config.ts"))
    if (/^ {2}run\s*:/m.test(tree.read(config)))
      failures.push(
        `${config} has a \`run\` block. Task running and caching belong to Nx (docs/adr/0002).`,
      );
  return failures;
}

// ADR 0001: lefthook owns Git hooks.
export function lefthookOwnsHooks(tree: Tree): string[] {
  return tree.repo.viteHooks || tree.paths.some((path) => path.startsWith(".vite-hooks/"))
    ? [".vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001)."]
    : [];
}

// ADR 0003, 0009: one betterleaks version, pinned in mise.toml.
export function oneBetterleaks(tree: Tree): string[] {
  const version = record(record(tree.parsed("mise.toml")).tools).betterleaks;
  if (typeof version !== "string")
    return ["mise.toml must pin betterleaks to an exact version (docs/adr/0009)."];
  const minimum = record(tree.parsed(".betterleaks.toml")).betterleaksMinVersion;
  return minimum === version
    ? []
    : [
        `.betterleaks.toml betterleaksMinVersion must equal the betterleaks version in mise.toml (${version}).`,
      ];
}

const inclusions: ReadonlySet<unknown> = new Set(["always", "fileMatch", "manual", "auto"]);

// The problems of one steering file. Malformed frontmatter is silently loaded as `always`.
function steeringProblems(path: string, text: string): string[] {
  const lines = text.split("\n");
  if (lines[0] !== "---") return ["must start with a frontmatter block"];
  const end = lines.indexOf("---", 1);
  if (end === -1) return ["frontmatter is not closed"];
  const document = parseDocument(lines.slice(1, end).join("\n"));
  const [error] = document.errors;
  // The position yaml gives counts from the line after the first `---`, so it is left out.
  if (error !== undefined)
    return [`frontmatter is not valid YAML (${error.message.split(" at line ")[0]})`];
  const inclusion = document.get("inclusion");
  const name = path.slice(path.lastIndexOf("/") + 1, -".md".length);
  const description = document.get("description");
  // A sequence comes back as its node, so that `flow` tells a one-line array from a block list.
  const pattern = document.get("fileMatchPattern");
  const problems: string[] = [];
  if (!inclusions.has(inclusion))
    problems.push("inclusion must be always, fileMatch, manual or auto");
  if (document.get("name") !== name) problems.push(`name must be "${name}"`);
  if (typeof description !== "string" || description.trim() === "")
    problems.push("description is required");
  if (inclusion === "fileMatch" && pattern === undefined)
    problems.push("fileMatchPattern is required for inclusion: fileMatch");
  if (inclusion !== "fileMatch" && pattern !== undefined)
    problems.push("fileMatchPattern is only for inclusion: fileMatch");
  if (pattern !== undefined && !(isSeq(pattern) && pattern.flow === true))
    problems.push("fileMatchPattern must be a one-line array");
  return problems;
}

// The paths the pathspec .kiro/steering/*.md matches, as cli.ts asks git for the untracked ones. A pathspec
// matches with fnmatch(3) without FNM_PATHNAME, so its * matches / too (gitglossary(7), "pathspec").
const isSteering = (path: string): boolean =>
  path.startsWith(".kiro/steering/") && path.endsWith(".md");

// docs/knowledge/steering-authoring.md: steering frontmatter.
export function steeringFrontmatter(tree: Tree): string[] {
  const files = [...tree.paths.filter(isSteering), ...tree.repo.untrackedSteering];
  return files.flatMap((path) =>
    steeringProblems(path, tree.read(path)).map(
      (problem) => `${path}: ${problem} (docs/knowledge/steering-authoring.md)`,
    ),
  );
}

// The shell scripts of this repository: the thin wrappers in tools/scripts/sh/ (docs/adr/0024). The agent skills
// under .agents/ and .kiro/skills/ are upstream files and are not checked.
const shellScript = /^tools\/scripts\/sh\/[^/]+\.sh$/;

const shellScripts = (tree: Tree): string[] => tree.paths.filter((path) => shellScript.test(path));

// Scripts that create or point git at another repository (git init / clone, git -C, --git-dir, GIT_DIR=).
// Run from a Git hook, such a script inherits GIT_DIR and GIT_INDEX_FILE and acts on this repository instead
// (docs/tooling/ci.md ("スクリプトのテスト")). The shell wrappers only run git on the repository they run in.
// A test that needs another repository is TypeScript and goes through gitIn (tools/scripts/src/test/sandbox.ts).
// Shell scripts only: a text pattern misses execFileSync("git", ["-C", ...]), so in TypeScript the
// no-restricted-imports rule on child_process (root vite.config.ts) and isolation.test.ts guard the same
// thing (docs/adr/0024).
// The pattern is tested on each line, so that a match never spans two lines; `\s` would match a newline.
const otherRepoGit = /(^|[^A-Za-z0-9_-])git\s+(init|clone)(\s|$)|git\s+-C\s|--git-dir|GIT_DIR=/;

export function gitOnOtherRepositories(tree: Tree): string[] {
  return shellScripts(tree)
    .filter((path) =>
      tree
        .read(path)
        .split("\n")
        .some((line) => otherRepoGit.test(line)),
    )
    .map(
      (path) =>
        `${path} runs git on another repository. A shell wrapper runs git only on the repository it runs in; write a test that needs another repository in TypeScript, with gitIn (docs/adr/0024).`,
    );
}

// The first number of a version or a range: 24 in "v24.1.2", ">=24" and "^24".
const major = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number"
    ? /[0-9]+/.exec(String(value))?.[0]
    : undefined;

// ADR 0013: one Node.js major version. .node-version decides it; the places that repeat it must agree.
// A change of the major otherwise leaves a stale copy behind (the API build target, the type definitions).
// The version is on the first line that starts with one; blank and comment lines before it are skipped.
export function oneNodeMajor(tree: Tree): string[] {
  const node = /^v?([0-9]+)/m.exec(tree.read(".node-version"))?.[1];
  if (node === undefined)
    return [
      ".node-version must start with a Node.js version such as 24 or 24.22.1 (docs/adr/0013).",
    ];
  const failures: string[] = [];
  const engines = major(record(record(tree.parsed("package.json")).engines).node);
  if (engines !== node)
    failures.push(
      `package.json engines.node (${engines ?? "unreadable"}) must be Node.js ${node}, the major of .node-version (docs/adr/0013).`,
    );
  const catalog = record(record(tree.parsed("pnpm-workspace.yaml")).catalog);
  const types = major(catalog["@types/node"]);
  if (types !== node)
    failures.push(
      `pnpm-workspace.yaml catalog @types/node (${types ?? "unreadable"}) must be Node.js ${node}, the major of .node-version (docs/adr/0013).`,
    );
  for (const config of tree.named("vite.config.ts"))
    for (const [, target] of tree.read(config).matchAll(/target:\s*"node([0-9]+)"/g))
      if (target !== node)
        failures.push(
          `${config} builds for node${target}, but .node-version is Node.js ${node} (docs/adr/0013).`,
        );
  return failures;
}

// The PostgreSQL image of compose.local.yaml (a hand-run stack) and postgresImage (tests and generated types)
// name the same tag. compose pins a digest after the tag (`postgres:18@sha256:...`), postgresImage does not,
// so only the part before `@` is compared (docs/tooling/local-worker.md, Issue #515).
export function onePostgresVersion(tree: Tree): string[] {
  const services = record(record(tree.parsed("compose.local.yaml")).services);
  const image = record(services.postgres).image;
  const composeTag = typeof image === "string" ? image.split("@")[0] : undefined;
  const testPath = "packages/db/src/testing/connection.ts";
  const testTag = /postgresImage\s*=\s*"([^"]+)"/.exec(tree.read(testPath))?.[1];
  if (composeTag === undefined)
    return ["compose.local.yaml must set services.postgres.image (docs/tooling/local-worker.md)."];
  if (testTag === undefined)
    return [
      `${testPath} must set postgresImage to a string literal (docs/tooling/local-worker.md).`,
    ];
  return composeTag === testTag
    ? []
    : [
        `compose.local.yaml postgres image (${composeTag}) must be the tag of postgresImage in ${testPath} (${testTag}) (docs/tooling/local-worker.md).`,
      ];
}

// ADR numbers are unique. Two branches can each take the next free number, and both ADRs can reach main
// without a merge conflict (docs/tooling/worktrees.md ("PR を出す")).
export function uniqueAdrNumbers(tree: Tree): string[] {
  const byNumber = new Map<string, string[]>();
  for (const path of tree.paths) {
    const number = /^docs\/adr\/([0-9]{4})-[^/]*\.md$/.exec(path)?.[1];
    if (number !== undefined) byNumber.set(number, [...(byNumber.get(number) ?? []), path]);
  }
  return [...byNumber]
    .filter(([, files]) => files.length > 1)
    .map(([number, files]) => `ADR ${number} is used by more than one file: ${files.join(" ")}`);
}

// Migrations only go forward (docs/adr/0025). A db/migrations/*.sql file of dbmate has two sections:
//   - down is a single `DO $$ BEGIN RAISE EXCEPTION '...'; END $$;`. dbmate's `rollback` with an empty down
//     succeeds and deletes the history row, so the database and its history drift apart.
//   - up starts with `SET LOCAL lock_timeout`, so a migration waiting for a table lock does not queue every
//     later request behind it. A file marked `transaction:false` runs without a transaction, where SET LOCAL
//     does nothing, so it is not asked for it.
const migrationFile = /(^|\/)db\/migrations\/[^/]+\.sql$/;

const withoutComments = (section: string): string => section.replace(/^[ \t]*--.*/gm, "").trim();

const lockTimeout = /^SET\s+LOCAL\s+lock_timeout\b/i;

const irreversibleDown = /^DO\s+\$\$\s*BEGIN\s+RAISE\s+EXCEPTION\s+'[^']+'\s*;\s*END\s*\$\$\s*;?$/i;

// The part of a dbmate migration after its `-- migrate:<name>` line, up to the next `-- migrate:` line. Its
// first line holds the options (`transaction:false`).
const migrationSection = (
  sql: string,
  name: string,
): { header: string; body: string } | undefined => {
  const marker = new RegExp(`^-- migrate:${name}\\b.*$`, "m").exec(sql);
  if (marker === null) return undefined;
  const rest = sql.slice(marker.index + marker[0].length);
  const next = rest.search(/^-- migrate:/m);
  return { header: marker[0], body: next === -1 ? rest : rest.slice(0, next) };
};

export function migrationsGoForward(tree: Tree): string[] {
  const failures: string[] = [];
  for (const path of tree.paths.filter((p) => migrationFile.test(p))) {
    const sql = tree.read(path);
    const down = migrationSection(sql, "down");
    if (down === undefined || !irreversibleDown.test(withoutComments(down.body)))
      failures.push(
        `${path} has a down section that is not only \`DO $$ BEGIN RAISE EXCEPTION '...'; END $$;\`. Migrations go forward only (docs/adr/0025).`,
      );
    const up = migrationSection(sql, "up");
    if (
      up === undefined ||
      !(up.header.includes("transaction:false") || lockTimeout.test(withoutComments(up.body)))
    )
      failures.push(
        `${path} does not start its up section with SET LOCAL lock_timeout. Add it, or mark the file transaction:false (docs/adr/0025).`,
      );
  }
  return failures;
}

// Hooks, CI and the tests run shell scripts directly, so git must record them as executable (100755).
export function executableScripts(tree: Tree): string[] {
  return shellScripts(tree)
    .filter((path) => tree.repo.tracked.get(path) !== "100755")
    .map(
      (path) => `${path} is not executable in git. Run \`chmod +x ${path}\` and stage it again.`,
    );
}

// Every shell wrapper has a process test with stub tools: tools/scripts/sh/<name>.sh and
// tools/scripts/src/sh/<name>.test.ts (docs/tooling/ci.md ("検査を足すとき" の 5)). A wrapper without one is not checked
// for the files it hands to its tool or for its exit code, and the real tool in <name>.tools.test.ts is too slow to cover that.
export function shellScriptsHaveTests(tree: Tree): string[] {
  return shellScripts(tree)
    .map((path) => ({
      path,
      test: path.replace(/^tools\/scripts\/sh\/(.+)\.sh$/, "tools/scripts/src/sh/$1.test.ts"),
    }))
    .filter(({ test }) => !tree.paths.includes(test))
    .map(
      ({ path, test }) =>
        `${path} has no process test. Write ${test}, with a stub tool from src/test/stubs.ts that checks what the script hands to the tool and its exit code (docs/tooling/ci.md, "検査を足すとき" の 5).`,
    );
}

// The pnpm catalog holds versions of registry packages. With catalogMode: prefer, `pnpm add <package>@workspace:*`
// writes the workspace package into the catalog and `catalog:` into the package.json, instead of `workspace:*`.
export function noWorkspaceInCatalog(tree: Tree): string[] {
  const workspace = record(tree.parsed("pnpm-workspace.yaml"));
  const catalogs: [string, unknown][] = [
    ["catalog", workspace.catalog],
    ...Object.entries(record(workspace.catalogs)).map(([name, value]): [string, unknown] => [
      `catalogs.${name}`,
      value,
    ]),
  ];
  return catalogs.flatMap(([where, catalog]) =>
    Object.entries(record(catalog))
      .filter(([, version]) => typeof version === "string" && version.startsWith("workspace:"))
      .map(
        ([name, version]) =>
          `pnpm-workspace.yaml ${where} has ${name}: ${String(version)}. A workspace package is not a catalog entry: write "workspace:*" in the package.json that depends on it and run pnpm install. With catalogMode: prefer, \`pnpm add <package>@workspace:*\` puts it in the catalog.`,
      ),
  );
}
