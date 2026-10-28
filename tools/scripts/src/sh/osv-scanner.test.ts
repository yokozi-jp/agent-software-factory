// Process tests for sh/osv-scanner.sh in a sandboxed repository. A stub `mise` returns each exit code of
// OSV-Scanner, so these cases need no network. The real OSV-Scanner is in osv-scanner.tools.test.ts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

// A stub `mise` that exits with `table` for the table scan, and for the SARIF scan (--format sarif) writes a
// file to --output-file and exits with `sarif`.
const scanWithSarif = (table: number, sarif: number) => {
  const file = join(box.root, "out.sarif");
  const body = [
    'case "$*" in',
    `  *"--format sarif"*) while [ $# -gt 0 ]; do [ "$1" = "--output-file" ] && echo '{"version":"2.1.0"}' > "$2"; shift; done; exit ${sarif} ;;`,
    "esac",
    `exit ${table}`,
  ].join("\n");
  const result = runIn(repo, "sh", [script], {
    env: {
      GITHUB_ACTIONS: "true",
      OSV_SARIF_FILE: file,
      PATH: withPath(stubDir(box.root, `mise-sarif-${table}-${sarif}`, { mise: body })),
    },
  });
  return { result, file };
};

describe("osv-scanner.sh with OSV_SARIF_FILE", () => {
  it("writes SARIF when it finds a vulnerability, and still passes with the warning", () => {
    const { result, file } = scanWithSarif(1, 1);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning title=osv-scanner::");
    expect(readFileSync(file, "utf8")).toContain("2.1.0");
  });

  it("leaves no file when the SARIF scan failed", () => {
    const { result, file } = scanWithSarif(1, 127);
    expect(result.status).toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  it("does not run the SARIF scan when the first scan failed", () => {
    const { result, file } = scanWithSarif(127, 0);
    expect(result.status).toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  it("writes no SARIF when OSV_SARIF_FILE is not set", () => {
    expect(scan(1, { GITHUB_ACTIONS: "true" }).stdout).not.toContain("sarif");
  });
});
