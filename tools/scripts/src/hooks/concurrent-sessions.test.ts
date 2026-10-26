import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { sandbox, type Sandbox } from "../test/sandbox.ts";
import {
  askedBefore,
  concurrentSessions,
  concurrentSessionsAsk,
  concurrentSessionsWarning,
  sessionsEnv,
  stateDirectory,
  type SessionsEnv,
} from "./concurrent-sessions.ts";

const here = "/work/tree";
// 100 is this session's process; the others are other live Kiro processes.
const live = new Set([100, 101, 102, 103]);
const isLiveKiro = (pid: number): boolean => live.has(pid);

let box: Sandbox;
let env: SessionsEnv;
beforeEach(() => {
  box = sandbox();
  env = { root: join(box.root, "v3"), legacy: join(box.root, "cli"), self: "self", here };
});
afterEach(() => {
  box.remove();
});

const write = (path: string, content: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
};
// The older layout: <legacy>/<id>.lock holds the pid, <id>.json the cwd and the title.
const legacySession = (id: string, pid: number | string, cwd: string, title = "test session") => {
  write(join(env.legacy, `${id}.lock`), JSON.stringify({ pid }));
  write(join(env.legacy, `${id}.json`), JSON.stringify({ cwd, title }));
};
// V3: <root>/<workspace hash>/<id>/.lock and session.json.
const v3Session = (
  workspace: string,
  id: string,
  pid: number | undefined,
  title: unknown = "v3",
  record = true,
) => {
  const dir = join(env.root, workspace, id);
  if (pid !== undefined) write(join(dir, ".lock"), JSON.stringify({ pid }));
  if (record) write(join(dir, "session.json"), JSON.stringify({ title, cwd: null }));
};

describe("concurrentSessions (older layout)", () => {
  it("finds nothing without a sessions directory", () => {
    expect(concurrentSessions(env, isLiveKiro)).toBeUndefined();
  });

  it("notes that its own record is missing, since the layout may have changed", () => {
    mkdirSync(env.legacy);
    expect(concurrentSessions(env, isLiveKiro)).toEqual({
      kind: "unreadable",
      note: `warn-concurrent-sessions could not find this session's record (self) in ${env.root}/<workspace>/sess_<id>/.lock or ${env.legacy}/<id>.lock. The Kiro session file layout may have changed, so concurrent sessions are not detected. Fix tools/scripts/src/hooks/concurrent-sessions.ts.`,
    });
  });

  it("notes an own record without a pid", () => {
    write(join(env.legacy, "self.lock"), '{"process":1}');
    write(join(env.legacy, "self.json"), JSON.stringify({ cwd: here }));
    expect(concurrentSessions(env, isLiveKiro)?.kind).toBe("unreadable");
  });

  it("notes an own record without a cwd", () => {
    write(join(env.legacy, "self.lock"), '{"pid":1}');
    write(join(env.legacy, "self.json"), "not json");
    expect(concurrentSessions(env, isLiveKiro)?.kind).toBe("unreadable");
  });

  it("is silent without a live kiro session in this working tree", () => {
    legacySession("self", 100, here);
    legacySession("other-dir", 101, "/somewhere/else");
    legacySession("stale", 999, here);
    legacySession("same-process", 100, here);
    legacySession("no-pid", "", here);
    write(join(env.legacy, "no-json.lock"), '{"pid":102}');
    write(join(env.legacy, "notes.txt"), "");
    write(join(env.legacy, "null.lock"), "null");
    write(join(env.legacy, "number.lock"), "102");
    expect(concurrentSessions(env, isLiveKiro)).toBeUndefined();
  });

  it("finds a live kiro session in this working tree, with the first line of its title", () => {
    legacySession("self", 100, here);
    // Made in reverse order: the list is sorted by id.
    legacySession("live2", "102", here, "two");
    legacySession("live", 101, here, `${"t".repeat(70)}\nsecond line`);
    expect(concurrentSessions(env, isLiveKiro)).toEqual({
      kind: "others",
      others: [
        { id: "live", pid: 101, title: "t".repeat(60) },
        { id: "live2", pid: 102, title: "two" },
      ],
    });
  });

  it("does not need its own record when the session id is unknown", () => {
    legacySession("live", 101, here);
    expect(concurrentSessions({ ...env, self: "" }, isLiveKiro)).toEqual({
      kind: "others",
      others: [{ id: "live", pid: 101, title: "test session" }],
    });
  });
});

describe("concurrentSessions (V3 layout)", () => {
  beforeEach(() => {
    v3Session("hashA", "sess_self", 100);
    v3Session("hashB", "sess_elsewhere", 101);
  });

  it("ignores a session in another workspace and a stale one", () => {
    v3Session("hashA", "sess_stale", 999);
    v3Session("hashA", "sess_same-process", 100);
    v3Session("hashA", "sess_no-lock", undefined);
    write(join(env.root, "hashA", "file"), "");
    expect(concurrentSessions(env, isLiveKiro)).toBeUndefined();
  });

  it("finds a live session in its own workspace directory", () => {
    v3Session("hashA", "sess_peer", 102, "peer\nmore");
    v3Session("hashA", "sess_untitled", 103, null);
    expect(concurrentSessions(env, isLiveKiro)).toEqual({
      kind: "others",
      others: [
        { id: "sess_peer", pid: 102, title: "peer" },
        { id: "sess_untitled", pid: 103, title: "" },
      ],
    });
  });

  it("finds its record from an id with the sess_ prefix", () => {
    v3Session("hashA", "sess_peer", 102);
    expect(concurrentSessions({ ...env, self: "sess_self" }, isLiveKiro)?.kind).toBe("others");
  });

  it("does not take a session directory without a record for its own", () => {
    mkdirSync(join(env.root, "hashE", "sess_empty"), { recursive: true });
    expect(concurrentSessions({ ...env, self: "empty" }, isLiveKiro)?.kind).toBe("unreadable");
  });

  it("finds its record from a .lock alone", () => {
    v3Session("hashD", "sess_lockonly", 100, "", false);
    v3Session("hashD", "sess_peer", 102);
    expect(concurrentSessions({ ...env, self: "lockonly" }, isLiveKiro)).toEqual({
      kind: "others",
      others: [{ id: "sess_peer", pid: 102, title: "v3" }],
    });
  });

  it("finds a non-interactive record, which has session.json but no .lock", () => {
    v3Session("hashC", "sess_batch", undefined);
    v3Session("hashC", "sess_peer", 102);
    expect(concurrentSessions({ ...env, self: "batch" }, isLiveKiro)).toEqual({
      kind: "others",
      others: [{ id: "sess_peer", pid: 102, title: "v3" }],
    });
  });

  it("also reads the older layout for sessions in this working tree", () => {
    legacySession("old", 101, here);
    expect(concurrentSessions(env, isLiveKiro)).toEqual({
      kind: "others",
      others: [{ id: "old", pid: 101, title: "test session" }],
    });
  });
});

const others = {
  kind: "others",
  others: [
    { id: "a", pid: 1, title: "first" },
    { id: "b", pid: 2, title: "" },
  ],
} as const;

describe("sessionsEnv", () => {
  it("reads the session records under the home directory by default", () => {
    expect(sessionsEnv({}, "/home/u", here)).toEqual({
      root: "/home/u/.kiro/sessions",
      legacy: "/home/u/.kiro/sessions/cli",
      self: "",
      here,
    });
  });

  it("takes the directories and the session id from the environment", () => {
    const vars = { KIRO_SESSIONS_ROOT: "/r", KIRO_SESSIONS_DIR: "/l", KIRO_SESSION_ID: "sess_1" };
    expect(sessionsEnv(vars, "/home/u", here)).toEqual({
      root: "/r",
      legacy: "/l",
      self: "sess_1",
      here,
    });
  });

  it("puts the older layout under a root from the environment", () => {
    expect(sessionsEnv({ KIRO_SESSIONS_ROOT: "/r" }, "/home/u", here).legacy).toBe("/r/cli");
  });
});

describe("askedBefore", () => {
  it("is false the first time for a key and true after, in a state directory it creates", () => {
    const state = join(box.root, "state", "kiro-hooks");
    expect(askedBefore(state, "self a")).toBe(false);
    expect(askedBefore(state, "self a")).toBe(true);
    expect(askedBefore(state, "self a b")).toBe(false);
  });

  it("asks every time when it cannot record the question", () => {
    const file = join(box.root, "file");
    writeFileSync(file, "");
    expect(askedBefore(join(file, "state"), "k")).toBe(false);
    expect(askedBefore(join(file, "state"), "k")).toBe(false);
  });
});

describe("stateDirectory", () => {
  it.each([
    [{ KIRO_HOOK_STATE_DIR: "/s", XDG_RUNTIME_DIR: "/x", TMPDIR: "/t" }, "/s"],
    [{ XDG_RUNTIME_DIR: "/x", TMPDIR: "/t" }, "/x/kiro-hooks"],
    [{ TMPDIR: "/t" }, "/t/kiro-hooks"],
    [{}, "/tmp/kiro-hooks"],
    [{ KIRO_HOOK_STATE_DIR: "", XDG_RUNTIME_DIR: "", TMPDIR: "" }, "/tmp/kiro-hooks"],
  ])("is %j → %s", (vars, dir) => {
    expect(stateDirectory(vars)).toBe(dir);
  });
});

describe("concurrentSessionsWarning", () => {
  it("lists the other sessions and says to work in a worktree", () => {
    expect(concurrentSessionsWarning(others, here)).toBe(
      [
        "WARNING: other Kiro sessions are running in this working tree (/work/tree):",
        "- session a (pid 1): first",
        "- session b (pid 2): ",
        "They share this index and these files. Before editing, committing, or switching branches,",
        "tell the user, and work in a separate git worktree (docs/tooling/worktrees.md).",
        "File tools (read, write, edit) resolve a relative path against this working tree, not against the worktree,",
        "so pass them absolute paths inside the worktree.",
        "",
      ].join("\n"),
    );
  });

  it("passes on the note about a missing record", () => {
    expect(concurrentSessionsWarning({ kind: "unreadable", note: "n" }, here)).toBe("NOTE: n\n");
  });
});

describe("concurrentSessionsAsk", () => {
  it("asks about the set of other sessions", () => {
    expect(concurrentSessionsAsk(others, "self", here)).toEqual({
      key: "self a b",
      reason: [
        "Other Kiro sessions are running in this working tree (/work/tree):",
        "- session a (pid 1): first",
        "- session b (pid 2): ",
        "They share this index and these files. Work in a separate git worktree (docs/tooling/worktrees.md). File tools resolve a relative path against this working tree, not the worktree: pass absolute paths.",
      ].join("\n"),
    });
  });

  it("keys the set by an unknown session when the id is not set", () => {
    expect(concurrentSessionsAsk(others, "", here).key).toBe("unknown a b");
  });

  it("asks once about a missing record", () => {
    expect(concurrentSessionsAsk({ kind: "unreadable", note: "n" }, "self", here)).toEqual({
      key: "unreadable self",
      reason: "n",
    });
  });
});
