// Process tests for sh/lint-workflows.sh in a sandboxed repository. A stub `mise` records how each linter is
// called and returns the exit code chosen per linter. The real jactionlint and zizmor, with the configuration
// of this repository, are in lint-workflows.tools.test.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { onlyCommands, stubDir, withPath } from "../test/stubs.ts";

const script = join(import.meta.dirname, "../../sh/lint-workflows.sh");

let box: Sandbox;
let repo: string;
let record: string;
const write = (path: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), "name: x\n");
};
// The script, with a `mise` that appends "<linter> <arguments>" to the record and exits with the code of
// that linter.
const lint = (jactionlint = 0, zizmor = 0) => {
  writeFileSync(record, "");
  const mise = `shift 2\necho "$@" >> "${record}"\ncase "$1" in jactionlint) exit ${jactionlint} ;; *) exit ${zizmor} ;; esac`;
  return runIn(repo, "sh", [script], {
    env: { PATH: withPath(stubDir(box.root, `mise-${jactionlint}-${zizmor}`, { mise })) },
  });
};
const calls = (): string[] => readFileSync(record, "utf8").trimEnd().split("\n");

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  record = join(box.root, "record");
  gitIn(repo, ["init", "-q", "-b", "main"]);
});
afterAll(() => {
  box.remove();
});

describe("lint-workflows.sh", () => {
  it("passes without running the linters when no workflow is tracked", () => {
    expect(lint().status).toBe(0);
    expect(readFileSync(record, "utf8")).toBe("");
  });

  describe("with tracked workflows", () => {
    beforeAll(() => {
      for (const path of [
        ".github/workflows/ci.yml",
        ".github/workflows/deploy.yaml",
        ".github/workflows/my flow.yml",
        // Not workflows: another directory, another extension.
        ".github/other/ci.yml",
        ".github/workflows/README.md",
      ])
        write(path);
      gitIn(repo, ["add", "-A"]);
      gitIn(repo, ["commit", "-qm", "base"]);
      // Not tracked: a scratch workflow must not fail the check.
      write(".github/workflows/scratch.yml");
    });

    it("hands the tracked workflows to jactionlint, and to zizmor with --offline", () => {
      const files =
        ".github/workflows/ci.yml .github/workflows/deploy.yaml .github/workflows/my flow.yml";
      expect(lint().status).toBe(0);
      // `echo "$@"` joins the file names with a space.
      expect(calls()).toEqual([`jactionlint ${files}`, `zizmor --offline ${files}`]);
    });

    it("fails when jactionlint reports a finding, and still runs zizmor", () => {
      expect(lint(1, 0).status).toBe(1);
      expect(calls()).toHaveLength(2);
    });

    it("fails when zizmor reports a finding", () => {
      expect(lint(0, 1).status).toBe(1);
    });

    it("fails, instead of skipping the check, without mise", () => {
      const path = onlyCommands(box.root, "no-mise", ["git", "sh", "xargs", "tr"]);
      const result = runIn(repo, "sh", [script], { env: { PATH: path } });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("lint-workflows: mise is not installed");
    });
  });
});
