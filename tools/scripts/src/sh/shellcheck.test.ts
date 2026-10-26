// Process tests for sh/shellcheck.sh in a sandboxed repository. A stub `mise` records the files that the script
// hands to shellcheck. The real shellcheck with the pinned version is in shellcheck.tools.test.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { onlyCommands, stubDir, withPath } from "../test/stubs.ts";

const script = join(import.meta.dirname, "../../sh/shellcheck.sh");

let box: Sandbox;
let repo: string;
let record: string;
const write = (path: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), "x\n");
};
// The script in `dir`, with a `mise` that records its arguments, one per line, and exits with `code`.
const lint = (dir: string, code = 0) =>
  runIn(dir, "sh", [script], {
    env: {
      PATH: withPath(
        stubDir(box.root, `mise-${code}`, {
          mise: `printf '%s\\n' "$@" > "${record}"\nexit ${code}`,
        }),
      ),
    },
  });

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  record = join(box.root, "record");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const path of [
    "a.sh",
    "sub/b.sh",
    "my script.sh",
    "notes.md",
    ".agents/skills/s/upstream.sh",
  ])
    write(path);
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-qm", "base"]);
  // Staged but not committed: the pre-commit hook lints it. Not tracked: a scratch file is not linted.
  write("staged.sh");
  gitIn(repo, ["add", "staged.sh"]);
  write("scratch.sh");
});
afterAll(() => {
  box.remove();
});

describe("shellcheck.sh", () => {
  it("lints the tracked and staged *.sh files with the pinned shellcheck, except .agents/", () => {
    expect(lint(repo).status).toBe(0);
    expect(readFileSync(record, "utf8").trimEnd().split("\n")).toEqual([
      "exec",
      "--",
      "shellcheck",
      "a.sh",
      "my script.sh",
      "staged.sh",
      "sub/b.sh",
    ]);
  });

  it("fails when shellcheck finds something", () => {
    expect(lint(repo, 1).status).not.toBe(0);
  });

  it("lists the same files from a subdirectory", () => {
    expect(lint(join(repo, "sub")).status).toBe(0);
    expect(readFileSync(record, "utf8")).toContain("a.sh\n");
  });

  it("fails, instead of skipping the check, without mise", () => {
    const path = onlyCommands(box.root, "no-mise", ["git", "sh", "xargs"]);
    const result = runIn(repo, "sh", [script], { env: { PATH: path } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("shellcheck: mise is not installed");
  });
});
