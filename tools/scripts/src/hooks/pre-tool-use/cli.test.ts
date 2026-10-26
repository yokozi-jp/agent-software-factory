// Process tests for the PreToolUse entry point: the event JSON Kiro writes to stdin, to the exit code,
// stderr and the permissionDecision on stdout. Which commands and files are refused is in the tests of
// the rule modules (../*.test.ts) and rules.test.ts.
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  gitIn,
  runIn,
  sandbox,
  startIn,
  type Background,
  type Sandbox,
} from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
// Each test starts Node a few times; on a loaded machine one start can take a second or more.
const processTimeout = 30_000;

let box: Sandbox;
let repo: string;
let sessions: string;
let state = 0;
let kiro: Background;

// The event in the shape Kiro 2.34.0 sends (acp-server.js): session_id, hook_event_name, cwd, tool_name,
// tool_input.
const event = (tool: string, input: unknown, cwd = repo) =>
  JSON.stringify({
    session_id: "s",
    hook_event_name: "PreToolUse",
    cwd,
    tool_name: tool,
    tool_input: input,
  });

// The hook with no other session, no override, and a fresh state directory unless one is given.
const hook = (input: string, env: Record<string, string> = {}, cwd = repo) => {
  state += 1;
  return runIn(cwd, process.execPath, [cli], {
    input,
    env: {
      KIRO_ALLOW_FORCE_PUSH: "",
      IWE_ALLOW_NORMALIZE: "",
      KIRO_ALLOW_GENERATED_WRITE: "",
      KIRO_SESSIONS_ROOT: join(box.root, "no-sessions"),
      KIRO_SESSIONS_DIR: join(box.root, "no-sessions"),
      KIRO_SESSION_ID: "",
      KIRO_HOOK_STATE_DIR: join(box.root, `state-${state}`),
      ...env,
    },
  });
};

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  mkdirSync(join(repo, "apps/web/src"), { recursive: true });
  mkdirSync(join(repo, ".agents/skills/tdd"), { recursive: true });
  mkdirSync(join(repo, ".kiro/skills"), { recursive: true });
  symlinkSync(join(repo, ".agents/skills/tdd"), join(repo, ".kiro/skills/tdd"));
  sessions = join(box.root, "sessions");
  kiro = startIn(box.root, process.execPath, ["-e", "setInterval(() => {}, 1000)", "kiro-fake"]);
});
afterAll(async () => {
  await kiro.stop();
  box.remove();
});

describe("pre-tool-use: refusing", { timeout: processTimeout }, () => {
  it("refuses a force push with exit 2 and the reason on stderr", () => {
    const result = hook(event("execute_bash", { command: "git status && git push --force" }));
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^block-force-push: refused\. .*docs\/adr\/0004\)\.\n$/);
  });

  it("allows an ordinary shell command with exit 0 and no output", () => {
    expect(hook(event("execute_bash", { command: "git push -u origin x" }))).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("lets a force push through with KIRO_ALLOW_FORCE_PUSH=1", () => {
    const result = hook(event("shell", { command: "git push -f" }), { KIRO_ALLOW_FORCE_PUSH: "1" });
    expect(result.status).toBe(0);
  });

  it("refuses iwe normalize from the shell and from the MCP tool, unless IWE_ALLOW_NORMALIZE=1", () => {
    expect(
      hook(event("execute_bash", { command: "cd docs && pnpm exec iwe normalize" })).status,
    ).toBe(2);
    expect(hook(event("@iwe/iwe_normalize", {})).stderr).toContain("block-iwe-normalize: refused.");
    expect(hook(event("@iwe/iwe_normalize", {}), { IWE_ALLOW_NORMALIZE: "1" }).status).toBe(0);
  });

  it("refuses a write to a generated file, resolving the path against the event's cwd", () => {
    const result = hook(
      event("fs_write", { path: "src/routeTree.gen.ts", text: "x" }, join(repo, "apps/web")),
      {},
      join(repo, "apps/web"),
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "block-generated-writes: refused fs_write on apps/web/src/routeTree.gen.ts.",
    );
  });

  it("refuses a skill through the .kiro/skills symlink, and an absolute path", () => {
    const viaLink = hook(
      event("str_replace", { path: ".kiro/skills/tdd/SKILL.md", oldStr: "a", newStr: "b" }),
    );
    expect(viaLink.stderr).toContain("refused str_replace on .agents/skills/tdd/SKILL.md.");
    const absolute = hook(
      event("delete_file", { targetFile: join(repo, "pnpm-lock.yaml"), explanation: "x" }),
    );
    expect(absolute.stderr).toContain("refused delete_file on pnpm-lock.yaml.");
  });

  it("allows a write to another file, a read, and a generated file with KIRO_ALLOW_GENERATED_WRITE=1", () => {
    expect(hook(event("fs_write", { path: "README.md", text: "x" })).status).toBe(0);
    expect(hook(event("read_file", { path: "pnpm-lock.yaml" })).status).toBe(0);
    const env = { KIRO_ALLOW_GENERATED_WRITE: "1" };
    expect(hook(event("fs_write", { path: "pnpm-lock.yaml", text: "x" }), env).status).toBe(0);
  });

  it("resolves against its own directory when the event's cwd does not exist", () => {
    const input = JSON.stringify({
      tool_name: "fs_write",
      cwd: "/nonexistent",
      tool_input: { path: "pnpm-lock.yaml" },
    });
    expect(hook(input).status).toBe(2);
  });

  it("allows a write outside a git repository", () => {
    const plain = join(box.root, "plain");
    mkdirSync(plain);
    expect(hook(event("fs_write", { path: "pnpm-lock.yaml" }, plain), {}, plain).status).toBe(0);
  });

  it.each(["not json", "", "[]", '{"tool_name":"fs_write"}'])(
    "allows what it cannot read: %j",
    (input) => {
      expect(hook(input).status).toBe(0);
    },
  );
});

describe("pre-tool-use: other sessions in this working tree", { timeout: processTimeout }, () => {
  // V3 layout: <root>/<workspace hash>/sess_<id>/.lock.
  const v3 = (workspace: string, id: string, pid: number) => {
    mkdirSync(join(sessions, workspace, id), { recursive: true });
    writeFileSync(join(sessions, workspace, id, ".lock"), JSON.stringify({ pid }));
    writeFileSync(join(sessions, workspace, id, "session.json"), '{"title":"peer"}');
  };
  const env = (self: string, stateDir: string) => ({
    KIRO_SESSIONS_ROOT: sessions,
    KIRO_SESSIONS_DIR: join(sessions, "cli"),
    KIRO_SESSION_ID: self,
    KIRO_HOOK_STATE_DIR: stateDir,
  });
  const decision = (stdout: string): unknown => (stdout === "" ? undefined : JSON.parse(stdout));

  it("asks once per set of sessions with a permissionDecision on stdout and exit 0", async () => {
    v3("hashA", "sess_me", process.pid);
    const stateDir = join(box.root, "asks");
    const shellCall = event("execute_bash", { command: "ls" });
    expect(hook(shellCall, env("sess_me", stateDir)).stdout).toBe("");

    v3("hashA", "sess_peer", kiro.pid);
    const first = hook(shellCall, env("sess_me", stateDir));
    expect(first.status).toBe(0);
    expect(decision(first.stdout)).toEqual({
      hookSpecificOutput: {
        permissionDecision: "ask",
        permissionDecisionReason: `Other Kiro sessions are running in this working tree (${repo}):\n- session sess_peer (pid ${kiro.pid}): peer\nThey share this index and these files. Work in a separate git worktree (docs/tooling/worktrees.md). File tools resolve a relative path against this working tree, not the worktree: pass absolute paths.`,
      },
    });
    expect(hook(event("fs_write", { path: "a" }), env("sess_me", stateDir)).stdout).toBe("");

    const another = startIn(box.root, process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
      "kiro-2",
    ]);
    v3("hashA", "sess_late", another.pid);
    expect(decision(hook(shellCall, env("sess_me", stateDir)).stdout)).toMatchObject({
      hookSpecificOutput: { permissionDecision: "ask" },
    });
    await another.stop();
  });

  it("asks once when it cannot find its own record", () => {
    const stateDir = join(box.root, "missing");
    const shellCall = event("execute_bash", { command: "ls" });
    const first = hook(shellCall, env("sess_missing", stateDir));
    expect(decision(first.stdout)).toEqual({
      hookSpecificOutput: {
        permissionDecision: "ask",
        permissionDecisionReason: `warn-concurrent-sessions could not find this session's record (sess_missing) in ${sessions}/<workspace>/sess_<id>/.lock or ${sessions}/cli/<id>.lock. The Kiro session file layout may have changed, so concurrent sessions are not detected. Fix tools/scripts/src/hooks/concurrent-sessions.ts.`,
      },
    });
    expect(hook(shellCall, env("sess_missing", stateDir)).stdout).toBe("");
  });

  it("refuses a force push without asking", () => {
    const result = hook(
      event("execute_bash", { command: "git push -f" }),
      env("sess_me", join(box.root, "refused")),
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });
});
