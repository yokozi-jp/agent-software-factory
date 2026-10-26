// The real commitlint (the commit-msg hook and the commitlint workflow) with the commitlint.config.ts of this
// repository, on a copy of the files that decide the scopes: the Nx project names come from the package.json
// files of the workspace (docs/repository/commit-conventions.md).
// Reads commitlint.config.ts, nx.json, package.json, pnpm-workspace.yaml, pnpm-lock.yaml and the package.json of
// apps/* of the workspace, inputs of the test-tools target (tools/scripts/package.json), and the one of tools/scripts.
import { cpSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const workspace = join(import.meta.dirname, "../../../..");
const commitlint = join(workspace, "node_modules/.bin/commitlint");

let box: Sandbox;
let repo: string;
// The message on stdin, as the commitlint workflow passes it. Nx reads its project graph in the sandbox,
// without the daemon and the cloud.
const lint = (message: string) =>
  runIn(repo, commitlint, [], {
    input: `${message}\n`,
    env: { NX_DAEMON: "false", NX_NO_CLOUD: "true", NX_ISOLATE_PLUGINS: "false" },
  });

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const file of [
    "commitlint.config.ts",
    "nx.json",
    "package.json",
    "pnpm-workspace.yaml",
    // Without it, the pnpm that devEngines in package.json names writes a lockfile of its own, which Nx cannot read.
    "pnpm-lock.yaml",
    "apps/api/package.json",
    "apps/web/package.json",
    "tools/scripts/package.json",
  ]) {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    cpSync(join(workspace, file), join(repo, file));
  }
  symlinkSync(join(workspace, "node_modules"), join(repo, "node_modules"));
}, 120_000);
afterAll(() => {
  box.remove();
});

describe("commitlint with scope-enum", () => {
  it.each([
    "feat(api): add a route",
    "fix(web): fix the layout",
    "chore(scripts): move the wrappers",
    "docs(docs): explain it",
    "ci(ci): speed up",
    "chore(hooks): add a hook",
    "chore(deps): update",
    "feat: no scope is allowed",
    "feat(api): 日本語の件名も通る",
  ])(
    "passes %j",
    (message) => {
      expect(lint(message)).toMatchObject({ status: 0 });
    },
    60_000,
  );

  it.each(["feat(unknown): x", "feat(apps/api): x", "feat(API): x"])(
    "fails %j on scope-enum, naming the allowed scopes",
    (message) => {
      const result = lint(message);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("scope must be one of [");
      expect(result.stdout).toContain("api");
      expect(result.stdout).toContain("deps");
    },
    60_000,
  );

  it("fails a message that is not a Conventional Commit", () => {
    expect(lint("update things").status).toBe(1);
  }, 60_000);
});
