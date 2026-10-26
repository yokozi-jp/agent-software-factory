// Process tests for sh/osv-scanner.sh in a sandboxed repository. A stub `mise` returns each exit code of
// OSV-Scanner, so these cases need no network. The real OSV-Scanner is in osv-scanner.tools.test.ts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { onlyCommands, stubDir, withPath } from "../test/stubs.ts";

const script = join(import.meta.dirname, "../../sh/osv-scanner.sh");

let box: Sandbox;
let repo: string;
beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
});
afterAll(() => {
  box.remove();
});

// The script with `mise exec -- osv-scanner` replaced by a stub that prints a line and exits with `code`.
const scan = (code: number, env: Record<string, string> = {}) =>
  runIn(repo, "sh", [script], {
    env: {
      GITHUB_ACTIONS: "",
      PATH: withPath(
        stubDir(box.root, `mise-${code}`, { mise: `echo stub-osv-scanner\nexit ${code}` }),
      ),
      ...env,
    },
  });

describe("osv-scanner.sh without pnpm-lock.yaml", () => {
  it("passes without scanning", () => {
    expect(scan(1)).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });
});

describe("osv-scanner.sh with pnpm-lock.yaml", () => {
  beforeAll(() => {
    writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  });

  it("passes without a warning when there is no vulnerability, or no package", () => {
    for (const code of [0, 128]) {
      const result = scan(code);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("stub-osv-scanner\n");
      expect(result.stderr).toBe("");
    }
  });

  it("passes with a warning when it finds a vulnerability", () => {
    const result = scan(1);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "osv-scanner: warning: pnpm-lock.yaml has dependencies with known vulnerabilities",
    );
  });

  it("warns with an annotation in GitHub Actions", () => {
    const result = scan(1, { GITHUB_ACTIONS: "true" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning title=osv-scanner::pnpm-lock.yaml has dependencies");
    expect(result.stderr).toBe("");
  });

  it("passes and says that the scan failed when OSV-Scanner could not run", () => {
    const result = scan(127);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("the scan failed (exit 127)");
  });

  it("passes and says that mise is missing", () => {
    const path = onlyCommands(box.root, "no-mise", ["git", "sh"]);
    const result = runIn(repo, "sh", [script], { env: { GITHUB_ACTIONS: "", PATH: path } });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("mise is not installed");
  });
});
