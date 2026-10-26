// The real OSV-Scanner pinned in mise.toml, through sh/osv-scanner.sh, on a pnpm lockfile with a known
// vulnerability written here. It queries osv.dev, so it needs the network.
// Reads mise.toml, mise.lock and .mise/locks/ of the workspace, the inputs of the test-tools target
// (tools/scripts/package.json). What the script does with each exit code is in osv-scanner.test.ts.
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, miseDirs, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const script = join(import.meta.dirname, "../../sh/osv-scanner.sh");
const workspace = join(import.meta.dirname, "../../../..");

// lodash 4.17.20 has known vulnerabilities (GHSA-35jh-r3h4-6jhm).
const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      lodash:
        specifier: 4.17.20
        version: 4.17.20

packages:

  lodash@4.17.20:
    resolution: {integrity: sha512-PlhdFcillOINfeV7Ni6oF1TAEayyZBoZ8bcshTHqOYJYlrqzRK5hagpagky5o4HfCzzd1TRkXPMFq6cKk9rGmA==}

snapshots:

  lodash@4.17.20: {}
`;

let box: Sandbox;
let repo: string;
beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const file of ["mise.toml", "mise.lock"]) cpSync(join(workspace, file), join(repo, file));
  // `mise exec` installs every missing tool in mise.toml, and Semgrep installs from .mise/locks/.
  cpSync(join(workspace, ".mise/locks"), join(repo, ".mise/locks"), { recursive: true });
  writeFileSync(join(repo, "pnpm-lock.yaml"), lockfile);
}, 300_000);
afterAll(() => {
  box.remove();
});

describe("osv-scanner.sh with the real OSV-Scanner", () => {
  it("finds lodash 4.17.20 in a pnpm lockfile, and passes", () => {
    const result = runIn(repo, "sh", [script], { env: { ...miseDirs(), GITHUB_ACTIONS: "" } });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain("GHSA-35jh-r3h4-6jhm");
  }, 300_000);
});
