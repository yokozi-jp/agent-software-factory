// The real shellcheck pinned in mise.toml, through sh/shellcheck.sh, on a repository in the sandbox.
// Reads mise.toml, mise.lock and .mise/locks/ of the workspace, the inputs of the test-tools target
// (tools/scripts/package.json). How the files are chosen is in shellcheck.test.ts.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, miseDirs, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const script = join(import.meta.dirname, "../../sh/shellcheck.sh");
const workspace = join(import.meta.dirname, "../../../..");

let box: Sandbox;
let repo: string;
const git = (...args: string[]): string => gitIn(repo, args).trim();
const lint = () => runIn(repo, "sh", [script], { env: miseDirs() });
const put = (path: string, text: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const file of ["mise.toml", "mise.lock"]) cpSync(join(workspace, file), join(repo, file));
  // `mise exec` installs every missing tool in mise.toml, and Semgrep installs from .mise/locks/.
  cpSync(join(workspace, ".mise/locks"), join(repo, ".mise/locks"), { recursive: true });
  put("good.sh", '#!/usr/bin/env sh\nset -eu\necho "$HOME"\n');
  git("add", "-A");
  git("commit", "-qm", "base");
}, 300_000);
afterAll(() => {
  box.remove();
});

describe("本物の shellcheck による shellcheck.sh", () => {
  it("きれいなスクリプトを通すこと", () => {
    expect(lint()).toMatchObject({ status: 0 });
  }, 300_000);

  it("追跡されたスクリプトの引用符のない変数を見つけること", () => {
    put("bad.sh", "#!/usr/bin/env sh\necho $HOME\n");
    git("add", "bad.sh");
    // xargs exits with 123 when shellcheck fails.
    const result = lint();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("SC2086");
    expect(result.stdout).toContain("bad.sh");
  }, 300_000);

  it("まだ commit していないステージ済みのスクリプトの問題を見つけること", () => {
    git("commit", "-qm", "bad");
    git("rm", "-q", "bad.sh");
    git("commit", "-qm", "remove bad");
    put("staged.sh", "#!/usr/bin/env sh\necho $HOME\n");
    git("add", "staged.sh");
    const result = lint();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("staged.sh");
  }, 300_000);

  it("upstream の skill を持つ .agents/ と、追跡されていないスクリプトを lint しないこと", () => {
    git("rm", "-qf", "staged.sh");
    put(".agents/skills/s/upstream.sh", "#!/usr/bin/env sh\necho $HOME\n");
    git("add", "-A");
    put("scratch.sh", "#!/usr/bin/env sh\necho $HOME\n");
    expect(lint()).toMatchObject({ status: 0 });
  }, 300_000);
});
