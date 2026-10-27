// The real betterleaks pinned in mise.toml, with this repository's .betterleaks.toml, on a repository in the
// sandbox that holds a token generated here. The token is never written to this repository: every git
// command goes through gitIn, and the only push goes to a bare repository in the sandbox.
// Reads .betterleaks.toml, mise.toml, mise.lock and .mise/locks/ of the workspace, the inputs of the
// test-tools target (tools/scripts/package.json). How the arguments are built is in cli.test.ts.
import { randomInt } from "node:crypto";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, miseDirs, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
const workspace = join(import.meta.dirname, "../../../../..");
const zero = "0".repeat(40);
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
// The shape of a GitHub personal access token (ghp_ and 36 characters), random on every run.
const token = `ghp_${Array.from({ length: 36 }, () => alphabet[randomInt(alphabet.length)]).join("")}`;

let box: Sandbox;
let repo: string;
let base: string;
let head: string;

const git = (...args: string[]): string => gitIn(repo, args).trim();
const scan = (args: string[], input = "") => {
  const result = runIn(repo, process.execPath, [cli, ...args], { input, env: miseDirs() });
  // --redact: a finding never shows the secret.
  expect(result.stdout + result.stderr).not.toContain(token);
  return result;
};

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  const remote = join(box.root, "remote.git");
  gitIn(remote, ["init", "-q", "--bare"]);
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const file of [".betterleaks.toml", "mise.toml", "mise.lock"])
    cpSync(join(workspace, file), join(repo, file));
  // `mise exec` installs every missing tool in mise.toml, and Semgrep installs from .mise/locks/.
  cpSync(join(workspace, ".mise/locks"), join(repo, ".mise/locks"), { recursive: true });
  git("add", "-A");
  git("commit", "-qm", "base");
  git("push", "-q", remote, "HEAD:refs/heads/main");
  // pre-push treats commits on remote-tracking branches as already pushed.
  git("fetch", "-q", remote, "+refs/heads/*:refs/remotes/sandbox/*");
  base = git("rev-parse", "HEAD");
}, 300_000);
afterAll(() => {
  box.remove();
});

describe("secret-scan with the real betterleaks and .betterleaks.toml", () => {
  it("passes clean history and files", () => {
    expect(scan(["all"]).status).toBe(0);
    expect(scan(["worktree"]).status).toBe(0);
  }, 300_000);

  it("finds a staged token, and passes it on a line marked betterleaks:allow", () => {
    writeFileSync(
      join(repo, "allowed.ts"),
      `export const key = "${token}"; // betterleaks:allow\n`,
    );
    git("add", "allowed.ts");
    expect(scan(["staged"]).status).toBe(0);
    writeFileSync(join(repo, "leak.ts"), `export const key = "${token}";\n`);
    git("add", "leak.ts");
    expect(scan(["staged"]).status).toBe(1);
    git("commit", "-qm", "leak");
    head = git("rev-parse", "HEAD");
  }, 120_000);

  it("finds the committed token in a range, the whole history and a push", () => {
    expect(scan(["range", base, head]).status).toBe(1);
    expect(scan(["all"]).status).toBe(1);
    expect(scan(["pre-push"], `refs/heads/main ${head} refs/heads/main ${base}\n`).status).toBe(1);
    expect(scan(["pre-push"], `refs/heads/x ${head} refs/heads/x ${zero}\n`).status).toBe(1);
  }, 120_000);
});
