// Process tests for sh/check-root-files.sh in a sandboxed repository. A stub `pnpm` records the files that the
// script hands to `vp check`, so the test needs neither the toolchain nor the files of this repository.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { stubDir, withPath } from "../test/stubs.ts";

const script = join(import.meta.dirname, "../../sh/check-root-files.sh");

let box: Sandbox;
let repo: string;
let record: string;
const write = (path: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), "x\n");
};
// The script in `dir`, with a `pnpm` that records its arguments, one per line, and exits with `code`.
const check = (dir: string, code = 0) =>
  runIn(dir, "sh", [script], {
    env: {
      PATH: withPath(
        stubDir(box.root, `pnpm-${code}`, {
          pnpm: `printf '%s\\n' "$@" > "${record}"\nexit ${code}`,
        }),
      ),
    },
  });
const checked = (): string[] => readFileSync(record, "utf8").trimEnd().split("\n");

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  record = join(box.root, "record");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const path of [
    // Outside the workspace packages: checked.
    "package.json",
    "README.md",
    "guides/guide.md",
    ".github/workflows/ci.yml",
    "guides/my file.md",
    "scripts-notes.md",
    // The workspace packages and the upstream skills: left to `nx affected -t check` and to the root config.
    "apps/api/src/index.ts",
    "packages/ui/src/index.ts",
    "tools/scripts/src/cli.ts",
    ".agents/skills/s/SKILL.md",
    ".kiro/skills/s/SKILL.md",
  ])
    write(path);
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-qm", "base"]);
  // Not tracked: a scratch file must not fail the check.
  write("scratch.md");
});
afterAll(() => {
  box.remove();
});

describe("check-root-files.sh", () => {
  it("runs vp check on the tracked files outside the packages and the skills, and only on them", () => {
    expect(check(repo).status).toBe(0);
    expect(checked()).toEqual([
      "exec",
      "vp",
      "check",
      "--no-error-on-unmatched-pattern",
      ".github/workflows/ci.yml",
      "README.md",
      "guides/guide.md",
      "guides/my file.md",
      "package.json",
      "scripts-notes.md",
    ]);
  });

  it("lists the same files from a subdirectory", () => {
    expect(check(join(repo, "guides")).status).toBe(0);
    expect(checked()).toContain("package.json");
  });

  it("fails when vp check fails", () => {
    expect(check(repo, 1).status).not.toBe(0);
  });
});
