import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { sandbox, type Sandbox } from "../test/sandbox.ts";
import {
  concurrentSessions,
  concurrentSessionsWarning,
  sessionsEnv,
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

describe("concurrentSessions (旧い配置)", () => {
  it("sessions ディレクトリがなければ何も見つけないこと", () => {
    expect(concurrentSessions(env, isLiveKiro)).toBeUndefined();
  });

  it("配置が変わったかもしれないので、自分の記録がないことを注記すること", () => {
    mkdirSync(env.legacy);
    expect(concurrentSessions(env, isLiveKiro)).toEqual({
      kind: "unreadable",
      note: `warn-concurrent-sessions could not find this session's record (self) in ${env.root}/<workspace>/sess_<id>/.lock or ${env.legacy}/<id>.lock. The Kiro session file layout may have changed, so concurrent sessions are not detected. Fix tools/scripts/src/hooks/concurrent-sessions.ts.`,
    });
  });

  it("pid のない自分の記録を注記すること", () => {
    write(join(env.legacy, "self.lock"), '{"process":1}');
    write(join(env.legacy, "self.json"), JSON.stringify({ cwd: here }));
    expect(concurrentSessions(env, isLiveKiro)?.kind).toBe("unreadable");
  });

  it("cwd のない自分の記録を注記すること", () => {
    write(join(env.legacy, "self.lock"), '{"pid":1}');
    write(join(env.legacy, "self.json"), "not json");
    expect(concurrentSessions(env, isLiveKiro)?.kind).toBe("unreadable");
  });

  it("この作業ツリーに生きている kiro セッションがなければ、何も言わないこと", () => {
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

  it("この作業ツリーの生きている kiro セッションを、title の最初の行とともに見つけること", () => {
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

  it("セッション ID が不明なとき、自分の記録を求めないこと", () => {
    legacySession("live", 101, here);
    expect(concurrentSessions({ ...env, self: "" }, isLiveKiro)).toEqual({
      kind: "others",
      others: [{ id: "live", pid: 101, title: "test session" }],
    });
  });
});

describe("concurrentSessions (V3 の配置)", () => {
  beforeEach(() => {
    v3Session("hashA", "sess_self", 100);
    v3Session("hashB", "sess_elsewhere", 101);
  });

  it("別のワークスペースのセッションと、古いセッションを無視すること", () => {
    v3Session("hashA", "sess_stale", 999);
    v3Session("hashA", "sess_same-process", 100);
    v3Session("hashA", "sess_no-lock", undefined);
    write(join(env.root, "hashA", "file"), "");
    expect(concurrentSessions(env, isLiveKiro)).toBeUndefined();
  });

  it("自分のワークスペースのディレクトリにある生きているセッションを見つけること", () => {
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

  it("sess_ の接頭辞のある ID から、自分の記録を見つけること", () => {
    v3Session("hashA", "sess_peer", 102);
    expect(concurrentSessions({ ...env, self: "sess_self" }, isLiveKiro)?.kind).toBe("others");
  });

  it("記録のないセッションのディレクトリを、自分のものと取らないこと", () => {
    mkdirSync(join(env.root, "hashE", "sess_empty"), { recursive: true });
    expect(concurrentSessions({ ...env, self: "empty" }, isLiveKiro)?.kind).toBe("unreadable");
  });

  it(".lock だけから自分の記録を見つけること", () => {
    v3Session("hashD", "sess_lockonly", 100, "", false);
    v3Session("hashD", "sess_peer", 102);
    expect(concurrentSessions({ ...env, self: "lockonly" }, isLiveKiro)).toEqual({
      kind: "others",
      others: [{ id: "sess_peer", pid: 102, title: "v3" }],
    });
  });

  it("session.json があり .lock のない、非対話の記録を見つけること", () => {
    v3Session("hashC", "sess_batch", undefined);
    v3Session("hashC", "sess_peer", 102);
    expect(concurrentSessions({ ...env, self: "batch" }, isLiveKiro)).toEqual({
      kind: "others",
      others: [{ id: "sess_peer", pid: 102, title: "v3" }],
    });
  });

  it("この作業ツリーのセッションについて、旧い配置も読むこと", () => {
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
  it("既定ではホームディレクトリの下のセッション記録を読むこと", () => {
    expect(sessionsEnv({}, "/home/u", here)).toEqual({
      root: "/home/u/.kiro/sessions",
      legacy: "/home/u/.kiro/sessions/cli",
      self: "",
      here,
    });
  });

  it("ディレクトリとセッション ID を環境変数から採ること", () => {
    const vars = { KIRO_SESSIONS_ROOT: "/r", KIRO_SESSIONS_DIR: "/l", KIRO_SESSION_ID: "sess_1" };
    expect(sessionsEnv(vars, "/home/u", here)).toEqual({
      root: "/r",
      legacy: "/l",
      self: "sess_1",
      here,
    });
  });

  it("環境変数のルートの下に旧い配置を置くこと", () => {
    expect(sessionsEnv({ KIRO_SESSIONS_ROOT: "/r" }, "/home/u", here).legacy).toBe("/r/cli");
  });
});

describe("concurrentSessionsWarning", () => {
  it("ほかのセッションを一覧にし、worktree で作業するよう述べること", () => {
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

  it("記録がないという注記をそのまま渡すこと", () => {
    expect(concurrentSessionsWarning({ kind: "unreadable", note: "n" }, here)).toBe("NOTE: n\n");
  });
});
