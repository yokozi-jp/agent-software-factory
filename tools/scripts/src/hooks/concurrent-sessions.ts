// warn-concurrent-sessions: find other live Kiro sessions that work in this working tree. Two sessions
// sharing one working tree overwrite each other's index and files; use a worktree instead
// (docs/tooling/worktrees.md). SessionStart prints a warning; PreToolUse asks the user once per set of
// other sessions, which also catches the sessions that started after this one.
//
// Session records are not a documented interface. Two layouts are read (checked against Kiro 2.34.0):
// - V3: <root>/<workspace hash>/sess_<id>/. An interactive session writes .lock with its pid;
//   `kiro-cli chat --no-interactive` writes only session.json, so this session is found by either file,
//   but another session is detected only by its .lock. There is one directory per workspace root, so
//   every other live session in the same <workspace hash> directory works in this working tree.
// - Older: <legacy>/<id>.lock holds the pid and <id>.json holds the cwd.
// This session is found by its id ($KIRO_SESSION_ID). When its record is in neither layout, the layout
// has probably changed and no session would be detected, so the hook says so instead of staying silent.
// Stale locks (pid not running, or not a kiro process) and sessions in this process are skipped.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The variables this hook reads.
export interface SessionsVariables {
  // Test settings: where the records are.
  readonly KIRO_SESSIONS_ROOT?: string | undefined;
  readonly KIRO_SESSIONS_DIR?: string | undefined;
  // Kiro sets it for a hook command (acp-server.js, the env of the hook's process).
  readonly KIRO_SESSION_ID?: string | undefined;
  readonly KIRO_HOOK_STATE_DIR?: string | undefined;
  readonly XDG_RUNTIME_DIR?: string | undefined;
  readonly TMPDIR?: string | undefined;
}

export function sessionsEnv(vars: SessionsVariables, home: string, here: string): SessionsEnv {
  const root = vars.KIRO_SESSIONS_ROOT || join(home, ".kiro/sessions");
  return {
    root,
    legacy: vars.KIRO_SESSIONS_DIR || join(root, "cli"),
    self: vars.KIRO_SESSION_ID ?? "",
    here,
  };
}

// Where the PreToolUse hook remembers what it asked about.
export function stateDirectory(vars: SessionsVariables): string {
  return (
    vars.KIRO_HOOK_STATE_DIR || join(vars.XDG_RUNTIME_DIR || vars.TMPDIR || "/tmp", "kiro-hooks")
  );
}

// Whether <key> was asked about before; records it as a marker file in <state>. When the marker cannot be
// written, it asks again rather than never.
export function askedBefore(state: string, key: string): boolean {
  const marker = join(
    state,
    // Stryker disable next-line StringLiteral: any encoding names the same marker for the same key.
    `concurrent-sessions-${createHash("sha256").update(key).digest("hex")}`,
  );
  try {
    mkdirSync(state, { recursive: true });
    // Stryker disable next-line StringLiteral: only the marker's existence is read, not its content.
    writeFileSync(marker, "", { flag: "wx" });
    return false;
  } catch {
    return existsSync(marker);
  }
}

export interface SessionsEnv {
  // <root> of the V3 layout (~/.kiro/sessions) and <legacy> of the older one (<root>/cli).
  readonly root: string;
  readonly legacy: string;
  // This session's id, or "" when unknown.
  readonly self: string;
  // This working tree.
  readonly here: string;
}

interface OtherSession {
  readonly id: string;
  readonly pid: number;
  readonly title: string;
}

export type Finding =
  | { readonly kind: "unreadable"; readonly note: string }
  | { readonly kind: "others"; readonly others: readonly OtherSession[] };

// The names in <dir>, sorted as a shell glob lists them. No test sees the sort: readdir listed the test's
// records sorted even when they were made in reverse order (Linux, /tmp).
const entries = (dir: string): string[] =>
  // Stryker disable next-line ArrayDeclaration,MethodExpression: a name that is not there has no record.
  existsSync(dir) ? readdirSync(dir).sort() : [];

// A JSON file's top-level field; undefined when the file is missing, not JSON, or has no such field.
function field(file: string, name: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(String(readFileSync(file)));
  } catch {
    // Missing or not JSON: no fields.
  }
  return Reflect.get(Object(value), name);
}

// The pid in a .lock file. NaN when there is none, which no process has: isLiveKiro is false for it.
const lockPid = (file: string): number => Number(field(file, "pid"));

// The first line of the title, 60 characters at most.
function title(file: string): string {
  const value = field(file, "title");
  return typeof value === "string"
    ? Array.from(value.replace(/\n.*/s, "")).slice(0, 60).join("")
    : "";
}

interface Own {
  readonly pid: number;
  // The V3 workspace directory, or "" when the record is in the older layout.
  readonly workspace: string;
}

// This session's record, or undefined when it is in neither layout.
function ownRecord(env: SessionsEnv): Own | undefined {
  for (const name of [env.self, `sess_${env.self}`]) {
    for (const workspace of entries(env.root)) {
      const dir = join(env.root, workspace, name);
      if (existsSync(join(dir, ".lock")) || existsSync(join(dir, "session.json")))
        return { pid: lockPid(join(dir, ".lock")), workspace: join(env.root, workspace) };
    }
  }
  const lock = join(env.legacy, `${env.self}.lock`);
  if (field(lock, "pid") === undefined || !field(join(env.legacy, `${env.self}.json`), "cwd"))
    return undefined;
  // Stryker disable next-line StringLiteral: a workspace directory that does not exist has no sessions.
  return { pid: lockPid(lock), workspace: "" };
}

export function concurrentSessions(
  env: SessionsEnv,
  isLiveKiro: (pid: number) => boolean,
): Finding | undefined {
  if (!existsSync(env.root) && !existsSync(env.legacy)) return undefined;
  // Without an id this session has no record to find, so every live session counts.
  // Stryker disable next-line ObjectLiteral,StringLiteral: no pid and no directory, as {} or another name.
  const own = env.self === "" ? { pid: Number.NaN, workspace: "" } : ownRecord(env);
  if (own === undefined)
    return {
      kind: "unreadable",
      note: `warn-concurrent-sessions could not find this session's record (${env.self}) in ${env.root}/<workspace>/sess_<id>/.lock or ${env.legacy}/<id>.lock. The Kiro session file layout may have changed, so concurrent sessions are not detected. Fix tools/scripts/src/hooks/concurrent-sessions.ts.`,
    };
  // A session in this process is this session (its own record is skipped this way too).
  const live = (pid: number): boolean => pid !== own.pid && isLiveKiro(pid);
  const others: OtherSession[] = [];
  // V3: the other sessions in this session's workspace directory.
  for (const id of entries(own.workspace)) {
    const dir = join(own.workspace, id);
    const pid = lockPid(join(dir, ".lock"));
    if (live(pid)) others.push({ id, pid, title: title(join(dir, "session.json")) });
  }
  // Older layout: the sessions whose recorded cwd is this working tree.
  for (const name of entries(env.legacy)) {
    // Stryker disable next-line ConditionalExpression,StringLiteral: <id>.json has no pid, so it is skipped anyway.
    if (!name.endsWith(".lock")) continue;
    const id = name.slice(0, -".lock".length);
    const record = join(env.legacy, `${id}.json`);
    const pid = lockPid(join(env.legacy, name));
    if (field(record, "cwd") === env.here && live(pid))
      others.push({ id, pid, title: title(record) });
  }
  return others.length === 0 ? undefined : { kind: "others", others };
}

const list = (others: readonly OtherSession[]): string =>
  others.map(({ id, pid, title }) => `- session ${id} (pid ${pid}): ${title}\n`).join("");

// The SessionStart text, added to the agent's context.
export function concurrentSessionsWarning(finding: Finding, here: string): string {
  if (finding.kind === "unreadable") return `NOTE: ${finding.note}\n`;
  return [
    `WARNING: other Kiro sessions are running in this working tree (${here}):`,
    `${list(finding.others)}They share this index and these files. Before editing, committing, or switching branches,`,
    "tell the user, and work in a separate git worktree (docs/tooling/worktrees.md).",
    "File tools (read, write, edit) resolve a relative path against this working tree, not against the worktree,",
    "so pass them absolute paths inside the worktree.",
    "",
  ].join("\n");
}

// The PreToolUse question, and the key under which it is asked only once.
export function concurrentSessionsAsk(
  finding: Finding,
  self: string,
  here: string,
): { readonly key: string; readonly reason: string } {
  if (finding.kind === "unreadable") return { key: `unreadable ${self}`, reason: finding.note };
  return {
    key: [self || "unknown", ...finding.others.map(({ id }) => id)].join(" "),
    reason: `Other Kiro sessions are running in this working tree (${here}):\n${list(finding.others)}They share this index and these files. Work in a separate git worktree (docs/tooling/worktrees.md). File tools resolve a relative path against this working tree, not the worktree: pass absolute paths.`,
  };
}
