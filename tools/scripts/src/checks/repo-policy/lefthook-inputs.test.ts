// Every file a rule of repo-policy reads by name must be in the glob of the pre-commit job `repo-policy` in
// lefthook.yml. Otherwise a commit that changes only that file skips the check, and the failure surfaces in CI (#515:
// compose.local.yaml was read by onePostgresVersion but missing from the glob).
// The paths are the string literals passed to tree.read, tree.parsed and tree.named in the rule files.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { list, record } from "./tree.ts";

const root = join(import.meta.dirname, "../../../../..");

// Whether a lefthook glob of the forms used in the repo-policy job covers the path: the path itself, `**/<name>`
// (the name at any depth) or `**/*.<ext>`.
export function covers(glob: string, path: string): boolean {
  if (glob === path) return true;
  if (glob.startsWith("**/*.")) return path.endsWith(glob.slice("**/*".length));
  if (glob.startsWith("**/")) {
    const name = glob.slice("**/".length);
    return path === name || path.endsWith(`/${name}`);
  }
  return false;
}

const readPaths = (): string[] => {
  const sources = readdirSync(import.meta.dirname).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );
  const found = new Set<string>();
  for (const file of sources) {
    const text = readFileSync(join(import.meta.dirname, file), "utf8");
    for (const [, path] of text.matchAll(/\btree\.(?:read|parsed|named)\("([^"]+)"/g))
      if (path !== undefined) found.add(path);
  }
  return [...found].sort();
};

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
    ["**/package.json", "package.json", true],
    ["**/package.json", "apps/api/package.json", true],
    ["**/package.json", "apps/api/xpackage.json", false],
    ["**/*.ts", "packages/db/src/testing/connection.ts", true],
    ["**/*.ts", "compose.local.yaml", false],
    ["docs/**", "compose.local.yaml", false],
  ])("%s covers %s: %s", (glob, path, expected) => {
    expect(covers(glob, path)).toBe(expected);
  });
});

describe("the repo-policy job of lefthook.yml", () => {
  it("reads the paths from the rule files", () => {
    expect(readPaths()).toContain("compose.local.yaml");
  });

  it("globs every file a rule reads by name", () => {
    const globs = jobGlob();
    expect(globs.length).toBeGreaterThan(0);
    const uncovered = readPaths().filter((path) => !globs.some((glob) => covers(glob, path)));
    expect(uncovered).toEqual([]);
  });
});
