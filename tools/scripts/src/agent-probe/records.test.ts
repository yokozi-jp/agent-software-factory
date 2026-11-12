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
  it("呼び出しの最後の記録を採り、呼び出しの順序を保つこと", () => {
    const jsonl = [call("a", "InProgress"), call("b", "completed"), call("a", "completed")];
    expect(calls(jsonl.join("\n")).map((c) => [c.status, c.verdict])).toEqual([
      ["completed", "allow"],
      ["completed", "allow"],
    ]);
  });

  it("規則が拒否した呼び出しを、その規則つきで読むこと", () => {
    const [first] = calls(call("a", "denied", denial));
    expect(first).toEqual({
      tool: "execute_bash",
      target: "ls",
      status: "denied",
      verdict: "deny",
      rule: '{"effect":"deny"}',
    });
  });

  it("一致した規則のない拒否を読むこと", () => {
    const [first] = calls(call("a", "denied", { _meta: { kiro: { policyDenial: { x: 1 } } } }));
    expect(first).toMatchObject({ verdict: "deny" });
    expect(first).not.toHaveProperty("rule");
  });

  it("拒否された確認と承認された確認を区別すること", () => {
    const ask = (id: string): string => line({ type: "pending_interaction", toolCallId: id });
    const jsonl = [ask("a"), call("a", "denied"), ask("b"), call("b", "completed")].join("\n");
    expect(calls(jsonl).map((c) => c.verdict)).toEqual(["ask-refused", "ask-approved"]);
  });

  it("規則も確認もなく拒否された呼び出しを、ブロックとして読むこと", () => {
    expect(calls(call("a", "denied")).map((c) => c.verdict)).toEqual(["blocked"]);
  });

  it("対象を 120 文字以内の 1 行で出力すること", () => {
    const [first] = calls(
      call("a", "completed", { args: { command: `a \n\t b${"x".repeat(200)}` } }),
    );
    expect(first?.target).toHaveLength(120);
    expect(first?.target.startsWith("a b")).toBe(true);
  });

  it("対象の前後の空白を取り除くこと", () => {
    const [first] = calls(call("a", "completed", { args: { command: "  \t ls -la \n" } }));
    expect(first?.target).toBe("ls -la");
  });

  it("許可された後に失敗した呼び出しを読むこと", () => {
    expect(calls(call("a", "failed")).map((c) => c.verdict)).toEqual(["failed"]);
  });

  it("呼び出しを、command、path、title の順で名付けること", () => {
    const named = (extra: Record<string, unknown>): string | undefined =>
      calls(line({ type: "tool_call", toolCallId: "a", status: "completed", ...extra }))[0]?.target;
    expect(named({ args: { command: "c", path: "p" }, title: "t" })).toBe("c");
    expect(named({ args: { path: "p" }, title: "t" })).toBe("p");
    expect(named({ title: "t" })).toBe("t");
    expect(named({})).toBe("");
  });

  it("JSON ではない行と、ほかの種類の記録を読み飛ばすこと", () => {
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
  it("呼び出しごとに 1 行を出力し、拒否には規則を添えること", () => {
    const list = calls([call("a", "completed"), call("b", "denied", denial)].join("\n"));
    expect(format(list)).toBe(
      'allow        execute_bash ls\ndeny         execute_bash ls  [{"effect":"deny"}]\n',
    );
  });

  it("呼び出しがないときは何も出力しないこと", () => {
    expect(format([])).toBe("");
  });
});

describe("inWorkspace", () => {
  const session = (workspacePaths: unknown): string => JSON.stringify({ workspacePaths });

  it("workspacePaths にその path がある セッションに一致すること", () => {
    expect(inWorkspace(session(["/a", "/b"]), "/b")).toBe(true);
  });

  it("ほかの path、前方一致、リストではない値には一致しないこと", () => {
    expect(inWorkspace(session(["/a/b"]), "/a")).toBe(false);
    expect(inWorkspace(session("/a"), "/a")).toBe(false);
    expect(inWorkspace("{}", "/a")).toBe(false);
  });

  it("JSON ではない session.json には一致しないこと", () => {
    expect(inWorkspace("not json", "/a")).toBe(false);
  });
});
