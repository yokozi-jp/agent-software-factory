// Process tests for the agent-probe entry point: argv and the sessions under HOME (the sandbox), to exit code and
// output. What is read from a record is in records.test.ts.
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");

let box: Sandbox;
const probe = (...args: string[]) => runIn(box.root, process.execPath, [cli, ...args]);

// A session of the workspaces, modified at the given second; its messages hold one call with the command.
function session(name: string, workspaces: string[], seconds: number, command: string): void {
  const dir = join(box.root, ".kiro", "sessions", "hash", name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "session.json");
  writeFileSync(file, JSON.stringify({ workspacePaths: workspaces }));
  utimesSync(file, seconds, seconds);
  const payload = {
    type: "tool_call",
    toolCallId: name,
    toolName: "execute_bash",
    args: { command },
    status: "completed",
  };
  writeFileSync(join(dir, "messages.jsonl"), `${JSON.stringify({ payload })}\n`);
}

beforeAll(() => {
  box = sandbox();
  session("old", ["/work"], 1000, "old command");
  session("new", ["/work"], 2000, "new command");
  session("other", ["/other"], 3000, "other command");
  // Entries of the sessions directory that are not sessions are skipped.
  writeFileSync(join(box.root, ".kiro", "sessions", "stray-file"), "");
  mkdirSync(join(box.root, ".kiro", "sessions", "hash", "no-session-json"));
});
afterAll(() => {
  box.remove();
});

describe("agent-probe", () => {
  it("prints the calls of the newest session of the workspace", () => {
    const result = probe("/work");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("allow        execute_bash new command\n");
  });

  it("exits 1 when no session has the workspace", () => {
    const result = probe("/nowhere");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("agent-probe: no Kiro session for /nowhere");
  });

  it.each([[[]], [["/a", "/b"]]])("exits 2 for the arguments %j", (args) => {
    const result = probe(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
  });
});
