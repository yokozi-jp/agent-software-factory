// The real Renovate pinned in sh/renovate.sh (through `pnpm dlx`, so it needs the network), on the
// renovate.jsonc of this repository and on configurations that Renovate refuses.
// Reads renovate.jsonc of the workspace, an input of the test-tools target (tools/scripts/package.json).
// How the script calls pnpm is in renovate.test.ts.
import { copyFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const script = join(import.meta.dirname, "../../sh/renovate.sh");
const workspace = join(import.meta.dirname, "../../../..");

let box: Sandbox;
let repo: string;
// runIn moves HOME into the sandbox, so pnpm would download Renovate again on every run. These keep its
// cache and store where they are.
const pnpmDirs = {
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
  XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"),
  XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"),
};
const validate = () => runIn(repo, "sh", [script, "validate"], { env: pnpmDirs });
const config = (text: string): void => writeFileSync(join(repo, "renovate.jsonc"), text);

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
});
afterAll(() => {
  box.remove();
});

describe("renovate.sh validate with the real renovate-config-validator", () => {
  it("passes the renovate.jsonc of this repository", () => {
    copyFileSync(join(workspace, "renovate.jsonc"), join(repo, "renovate.jsonc"));
    expect(validate().status).toBe(0);
  }, 300_000);

  it("fails on an unknown option", () => {
    config('{ "extends": ["config:best-practices"], "notAnOption": true }\n');
    expect(validate().status).toBe(1);
  }, 300_000);

  it("fails on a bad value", () => {
    config('{ "extends": ["config:best-practices"], "semanticCommits": "sometimes" }\n');
    expect(validate().status).toBe(1);
  }, 300_000);
});
