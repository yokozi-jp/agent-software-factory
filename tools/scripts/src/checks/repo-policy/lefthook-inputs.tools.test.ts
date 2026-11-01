// Every file a rule of repo-policy reads must be in the glob of the pre-commit job `repo-policy` in
// lefthook.yml. Otherwise a commit that changes only that file skips the check, and the failure surfaces in CI (#515:
// compose.local.yaml was read by onePostgresVersion but missing from the glob).
// The paths are the ones the rules asked the Tree for (read, maybe, parsed, named) while checking passing-repo, so a
// path built in a variable counts, and so does a file passing-repo lacks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { repo } from "./fixtures/repo.ts";
import { readPaths } from "./rules.ts";
import { list, record } from "./tree.ts";

const root = join(import.meta.dirname, "../../../../..");

// Whether a lefthook glob covers the path. A glob without a slash (`*.md`) matches the file name at any depth; `**/`
// matches any directories, including none; `*` stays inside one name.
export function covers(glob: string, path: string): boolean {
  const pattern = glob.replace(/\*\*\/|\*\*|\*|[.+^$(){}|[\]\\]/g, (token) => {
    if (token === "**/") return "(?:.*/)?";
    if (token === "**") return ".*";
    if (token === "*") return "[^/]*";
    return `\\${token}`;
  });
  return new RegExp(glob.includes("/") ? `^${pattern}$` : `^(?:.*/)?${pattern}$`).test(path);
}

const jobGlob = (): string[] => {
  const lefthook = record(parse(readFileSync(join(root, "lefthook.yml"), "utf8")));
  const stack: unknown[] = list(record(lefthook["pre-commit"]).jobs);
  while (stack.length > 0) {
    const job = record(stack.pop());
    if (job.name === "repo-policy")
      return list(job.glob).filter((glob) => typeof glob === "string");
    stack.push(...list(record(job.group).jobs));
  }
  return [];
};

describe("covers", () => {
  it.each([
    ["compose.local.yaml", "compose.local.yaml", true],
    ["compose.local.yaml", "x/compose.local.yaml", true],
    ["**/package.json", "package.json", true],
    ["**/package.json", "apps/api/package.json", true],
    ["**/package.json", "apps/api/xpackage.json", false],
    ["**/*.ts", "packages/db/src/testing/connection.ts", true],
    ["**/*.ts", "compose.local.yaml", false],
    ["*.md", "docs/index.md", true],
    ["*.md", "docs/index.mdx", false],
    ["docs/**", "docs/tooling/ci.md", true],
    ["docs/**", "compose.local.yaml", false],
    ["docs/**", "xdocs/a.md", false],
    [".github/**", ".github/workflows/ci.yml", true],
    ["tools/scripts/sh/**", "tools/scripts/sh/worktree.sh", true],
  ])("%s covers %s: %s", (glob, path, expected) => {
    expect(covers(glob, path)).toBe(expected);
  });
});

const uncovered = (paths: readonly string[], globs: readonly string[]): string[] =>
  paths.filter((path) => !globs.some((glob) => covers(glob, path)));

describe("the repo-policy job of lefthook.yml", () => {
  const paths = readPaths(repo());

  it("records the paths the rules read, whether passing-repo has the file or not", () => {
    expect(paths).toContain("compose.local.yaml");
    expect(paths).toContain("apps/api/package.json");
    expect(paths).toContain("package.json");
  });

  it("globs every path a rule reads", () => {
    const globs = jobGlob();
    expect(globs.length).toBeGreaterThan(0);
    expect(uncovered(paths, globs)).toEqual([]);
  });

  it.each(["compose.local.yaml", "**/package.json", "pnpm-workspace.yaml", "**/tsconfig.json"])(
    "fails when %s is left out of the glob",
    (glob) => {
      const globs = jobGlob();
      expect(globs).toContain(glob);
      expect(
        uncovered(
          paths,
          globs.filter((other) => other !== glob),
        ),
      ).not.toEqual([]);
    },
  );
});
