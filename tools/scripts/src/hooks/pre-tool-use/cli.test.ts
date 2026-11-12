// Process tests for the PreToolUse entry point: the event JSON Kiro writes to stdin, to the exit code,
// stderr and stdout. Which commands and files are refused is in the tests of
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

// The hook with no other session and no override unless <env> gives them.
const hook = (input: string, env: Record<string, string> = {}, cwd = repo) =>
  runIn(cwd, process.execPath, [cli], {
    input,
    env: {
      KIRO_ALLOW_FORCE_PUSH: "",
      IWE_ALLOW_NORMALIZE: "",
      KIRO_ALLOW_GENERATED_WRITE: "",
      KIRO_SESSIONS_ROOT: join(box.root, "no-sessions"),
      KIRO_SESSIONS_DIR: join(box.root, "no-sessions"),
      KIRO_SESSION_ID: "",
      ...env,
    },
  });

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

describe("pre-tool-use: 拒否", { timeout: processTimeout }, () => {
  it("終了コード 0 で尋ね、判断を stdout に JSON で出力すること", () => {
    const result = hook(event("execute_bash", { command: "git checkout -- a.ts && git status" }));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        permissionDecision: "ask",
        permissionDecisionReason: expect.stringMatching(/^ask-discard-changes: /) as unknown,
      },
    });
  });
  it("force push を終了コード 2 で拒否し、理由を stderr に出力すること", () => {
    const result = hook(event("execute_bash", { command: "git status && git push --force" }));
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^block-force-push: refused\. .*docs\/adr\/0004\)\.\n$/);
  });

  it("通常のシェルコマンドを終了コード 0 で許可し、何も出力しないこと", () => {
    expect(hook(event("execute_bash", { command: "git push -u origin x" }))).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("KIRO_ALLOW_FORCE_PUSH=1 のとき force push を通すこと", () => {
    const result = hook(event("shell", { command: "git push -f" }), { KIRO_ALLOW_FORCE_PUSH: "1" });
    expect(result.status).toBe(0);
  });

  it("変数にかかわらず、禁止のコマンドを終了コード 2 で拒否すること", () => {
    const env = { KIRO_ALLOW_FORCE_PUSH: "1", KIRO_ALLOW_GENERATED_WRITE: "1" };
    const result = hook(event("execute_bash", { command: "gh pr merge 12 --squash" }), env);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      /^block-forbidden-commands: refused\. .*agent-permissions\.md\)\.\n$/,
    );
  });

  it("変数にかかわらず .kiro/settings への書き込みを拒否し、.kiro/agents を許可すること", () => {
    mkdirSync(join(repo, ".kiro/settings"), { recursive: true });
    const env = { KIRO_ALLOW_GENERATED_WRITE: "1" };
    const settings = hook(event("fs_write", { path: ".kiro/settings/cli.json", text: "x" }), env);
    expect(settings.status).toBe(2);
    expect(settings.stderr).toContain(
      "block-settings-writes: refused fs_write on .kiro/settings/cli.json.",
    );
    expect(hook(event("fs_write", { path: ".kiro/agents/factory.json", text: "x" })).status).toBe(
      0,
    );
  });

  it("IWE_ALLOW_NORMALIZE=1 でない限り、シェルと MCP tool からの iwe normalize を拒否すること", () => {
    expect(
      hook(event("execute_bash", { command: "cd docs && pnpm exec iwe normalize" })).status,
    ).toBe(2);
    expect(hook(event("@iwe/iwe_normalize", {})).stderr).toContain("block-iwe-normalize: refused.");
    expect(hook(event("@iwe/iwe_normalize", {}), { IWE_ALLOW_NORMALIZE: "1" }).status).toBe(0);
  });

  it("イベントの cwd に対して path を解決し、生成されたファイルへの書き込みを拒否すること", () => {
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

  it(".kiro/skills の symlink 経由の skill と、絶対 path を拒否すること", () => {
    const viaLink = hook(
      event("str_replace", { path: ".kiro/skills/tdd/SKILL.md", oldStr: "a", newStr: "b" }),
    );
    expect(viaLink.stderr).toContain("refused str_replace on .agents/skills/tdd/SKILL.md.");
    const absolute = hook(
      event("delete_file", { targetFile: join(repo, "pnpm-lock.yaml"), explanation: "x" }),
    );
    expect(absolute.stderr).toContain("refused delete_file on pnpm-lock.yaml.");
  });

  it("ほかのファイルへの書き込み、読み取り、KIRO_ALLOW_GENERATED_WRITE=1 の生成されたファイルを許可すること", () => {
    expect(hook(event("fs_write", { path: "README.md", text: "x" })).status).toBe(0);
    expect(hook(event("read_file", { path: "pnpm-lock.yaml" })).status).toBe(0);
    const env = { KIRO_ALLOW_GENERATED_WRITE: "1" };
    expect(hook(event("fs_write", { path: "pnpm-lock.yaml", text: "x" }), env).status).toBe(0);
  });

  it("イベントの cwd がないとき、自分のディレクトリに対して解決すること", () => {
    const input = JSON.stringify({
      tool_name: "fs_write",
      cwd: "/nonexistent",
      tool_input: { path: "pnpm-lock.yaml" },
    });
    expect(hook(input).status).toBe(2);
  });

  it("git リポジトリの外への書き込みを許可すること", () => {
    const plain = join(box.root, "plain");
    mkdirSync(plain);
    expect(hook(event("fs_write", { path: "pnpm-lock.yaml" }, plain), {}, plain).status).toBe(0);
  });

  it.each(["not json", "", "[]", '{"tool_name":"fs_write"}'])(
    "読めないものを許可すること: %j",
    (input) => {
      expect(hook(input).status).toBe(0);
    },
  );
});

describe("pre-tool-use: この作業ツリーのほかのセッション", { timeout: processTimeout }, () => {
  // Only SessionStart warns about them; the PreToolUse entry does not ask (#191).
  it("ほかの生きたセッションがここで作業していても、シェルの呼び出しや書き込みの前に尋ねないこと", () => {
    mkdirSync(join(sessions, "hashA", "sess_me"), { recursive: true });
    writeFileSync(
      join(sessions, "hashA", "sess_me", ".lock"),
      JSON.stringify({ pid: process.pid }),
    );
    mkdirSync(join(sessions, "hashA", "sess_peer"), { recursive: true });
    writeFileSync(join(sessions, "hashA", "sess_peer", ".lock"), JSON.stringify({ pid: kiro.pid }));
    const env = {
      KIRO_SESSIONS_ROOT: sessions,
      KIRO_SESSIONS_DIR: join(sessions, "cli"),
      KIRO_SESSION_ID: "sess_me",
    };
    for (const call of [
      event("execute_bash", { command: "ls" }),
      event("fs_write", { path: "a", text: "x" }),
    ])
      expect(hook(call, env)).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});
