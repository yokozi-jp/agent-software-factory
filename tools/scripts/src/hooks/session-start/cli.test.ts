// Process tests for the SessionStart entry point: the event JSON on stdin and a real git repository and
// session records in the sandbox, to stdout (added to the agent's context) and exit 0. What the warnings
// say is in ../concurrent-sessions.test.ts and ../stale-checkout.test.ts.
import { mkdirSync, writeFileSync } from "node:fs";
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
let clone: string;
let kiro: Background;

const sessionStart = (cwd: string, env: Record<string, string> = {}) =>
  runIn(cwd, process.execPath, [cli], {
    input: JSON.stringify({ session_id: "s", hook_event_name: "SessionStart", cwd }),
    env: {
      KIRO_SESSIONS_ROOT: join(box.root, "no-sessions"),
      KIRO_SESSIONS_DIR: join(box.root, "no-sessions"),
      KIRO_SESSION_ID: "",
      KIRO_STALE_CHECKOUT_BASE: "",
      ...env,
    },
  });

beforeAll(() => {
  box = sandbox();
  const origin = join(box.root, "origin.git");
  const seed = join(box.root, "seed");
  clone = join(box.root, "clone");
  gitIn(origin, ["init", "-q", "--bare", "-b", "main"]);
  gitIn(seed, ["clone", "-q", origin, "."]);
  gitIn(seed, ["checkout", "-q", "-b", "main"]);
  gitIn(seed, ["commit", "-q", "--allow-empty", "-m", "one"]);
  gitIn(seed, ["push", "-q", "origin", "main"]);
  gitIn(clone, ["clone", "-q", origin, "."]);
  gitIn(seed, ["commit", "-q", "--allow-empty", "-m", "two"]);
  gitIn(seed, ["push", "-q", "origin", "main"]);
  kiro = startIn(box.root, process.execPath, ["-e", "setInterval(() => {}, 1000)", "kiro-fake"]);
});
afterAll(async () => {
  await kiro.stop();
  box.remove();
});

describe("session-start", { timeout: processTimeout }, () => {
  it("is silent and exits 0 outside a git repository with no other session", () => {
    const plain = join(box.root, "plain");
    mkdirSync(plain);
    expect(sessionStart(plain)).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("warns about another session in this working tree and about a stale main, in that order", () => {
    const sessions = join(box.root, "sessions");
    for (const [id, pid] of [
      ["sess_me", process.pid],
      ["sess_peer", kiro.pid],
    ] as const) {
      mkdirSync(join(sessions, "hashA", id), { recursive: true });
      writeFileSync(join(sessions, "hashA", id, ".lock"), JSON.stringify({ pid }));
    }
    const result = sessionStart(clone, {
      KIRO_SESSIONS_ROOT: sessions,
      KIRO_SESSIONS_DIR: join(sessions, "cli"),
      KIRO_SESSION_ID: "sess_me",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      new RegExp(
        `^WARNING: other Kiro sessions are running in this working tree \\(${clone}\\):\\n- session sess_peer \\(pid ${kiro.pid}\\): \\n[^]*\\nWARNING: this working tree \\(${clone}\\) is on main, 1 commit\\(s\\) behind origin/main\\.\\n`,
      ),
    );
  });

  it("says when it cannot find this session's record", () => {
    mkdirSync(join(box.root, "empty-sessions"));
    const result = sessionStart(clone, {
      KIRO_SESSIONS_ROOT: join(box.root, "empty-sessions"),
      KIRO_SESSION_ID: "sess_gone",
      KIRO_STALE_CHECKOUT_BASE: "origin/none",
    });
    expect(result.stdout).toMatch(
      /^NOTE: warn-concurrent-sessions could not find this session's record \(sess_gone\)/,
    );
  });
});
