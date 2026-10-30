// What is read from a session record of Kiro: the verdict of each call, and the session of a workspace.
import { describe, expect, it } from "vite-plus/test";
import { calls, format, inWorkspace } from "./records.ts";

const line = (payload: unknown): string => JSON.stringify({ id: "x", payload });
const call = (id: string, status: string, extra: Record<string, unknown> = {}): string =>
  line({
    type: "tool_call",
    toolCallId: id,
    toolName: "execute_bash",
    args: { command: "ls" },
    status,
    ...extra,
  });
const denial = { _meta: { kiro: { policyDenial: { matchedRule: { effect: "deny" } } } } };

describe("calls", () => {
  it("takes the last record of a call, and keeps the order of the calls", () => {
    const jsonl = [call("a", "InProgress"), call("b", "completed"), call("a", "completed")];
    expect(calls(jsonl.join("\n")).map((c) => [c.status, c.verdict])).toEqual([
      ["completed", "allow"],
      ["completed", "allow"],
    ]);
  });

  it("reads a call that a rule denied, with the rule", () => {
    const [first] = calls(call("a", "denied", denial));
    expect(first).toEqual({
      tool: "execute_bash",
      target: "ls",
      status: "denied",
      verdict: "deny",
      rule: '{"effect":"deny"}',
    });
  });

  it("reads a denial without the matched rule", () => {
    const [first] = calls(call("a", "denied", { _meta: { kiro: { policyDenial: { x: 1 } } } }));
    expect(first).toMatchObject({ verdict: "deny" });
    expect(first).not.toHaveProperty("rule");
  });

  it("tells a confirmation that was refused from one that was approved", () => {
    const ask = (id: string): string => line({ type: "pending_interaction", toolCallId: id });
    const jsonl = [ask("a"), call("a", "denied"), ask("b"), call("b", "completed")].join("\n");
    expect(calls(jsonl).map((c) => c.verdict)).toEqual(["ask-refused", "ask-approved"]);
  });

  it("reads a call that was denied with no rule and no confirmation as blocked", () => {
    expect(calls(call("a", "denied")).map((c) => c.verdict)).toEqual(["blocked"]);
  });

  it("prints the target as one line of at most 120 characters", () => {
    const [first] = calls(
      call("a", "completed", { args: { command: `a \n\t b${"x".repeat(200)}` } }),
    );
    expect(first?.target).toHaveLength(120);
    expect(first?.target.startsWith("a b")).toBe(true);
  });

  it("trims the spaces around the target", () => {
    const [first] = calls(call("a", "completed", { args: { command: "  \t ls -la \n" } }));
    expect(first?.target).toBe("ls -la");
  });

  it("reads a call that failed after it was allowed", () => {
    expect(calls(call("a", "failed")).map((c) => c.verdict)).toEqual(["failed"]);
  });

  it("names the call by its command, then its path, then its title", () => {
    const named = (extra: Record<string, unknown>): string | undefined =>
      calls(line({ type: "tool_call", toolCallId: "a", status: "completed", ...extra }))[0]?.target;
    expect(named({ args: { command: "c", path: "p" }, title: "t" })).toBe("c");
    expect(named({ args: { path: "p" }, title: "t" })).toBe("p");
    expect(named({ title: "t" })).toBe("t");
    expect(named({})).toBe("");
  });

  it("skips lines that are not JSON, and records of other types", () => {
    const jsonl = [
      "",
      "not json",
      line("text"),
      "null",
      line({ type: "user" }),
      call("a", "completed"),
    ];
    expect(calls(jsonl.join("\n"))).toHaveLength(1);
  });
});

describe("format", () => {
  it("prints a line per call, with the rule of a denial", () => {
    const list = calls([call("a", "completed"), call("b", "denied", denial)].join("\n"));
    expect(format(list)).toBe(
      'allow        execute_bash ls\ndeny         execute_bash ls  [{"effect":"deny"}]\n',
    );
  });

  it("prints nothing for no calls", () => {
    expect(format([])).toBe("");
  });
});

describe("inWorkspace", () => {
  const session = (workspacePaths: unknown): string => JSON.stringify({ workspacePaths });

  it("matches a session whose workspacePaths has the path", () => {
    expect(inWorkspace(session(["/a", "/b"]), "/b")).toBe(true);
  });

  it("does not match another path, a prefix, or a value that is not a list", () => {
    expect(inWorkspace(session(["/a/b"]), "/a")).toBe(false);
    expect(inWorkspace(session("/a"), "/a")).toBe(false);
    expect(inWorkspace("{}", "/a")).toBe(false);
  });

  it("does not match a session.json that is not JSON", () => {
    expect(inWorkspace("not json", "/a")).toBe(false);
  });
});
