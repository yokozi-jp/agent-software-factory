import { describe, expect, it } from "vite-plus/test";
import { preToolUse, preToolUseMatcher, type PreToolUseDeps } from "./rules.ts";

const shell = (command: string, tool = "execute_bash") => ({
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: { command },
});
const write = (tool: string, path: string) => ({
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: { path, text: "x" },
});

interface Calls {
  targets: string[];
  concurrent: number;
  asked: string[];
}
// Deps that record what was asked of them. <generated> are the paths writeTarget reports as written.
function deps(
  options: { ask?: { key: string; reason: string }; asked?: string[] } = {},
): PreToolUseDeps & { calls: Calls } {
  const calls: Calls = { targets: [], concurrent: 0, asked: [] };
  const seen = new Set(options.asked ?? []);
  return {
    calls,
    writeTarget(tool, input) {
      calls.targets.push(tool);
      const path: unknown = Reflect.get(
        Object(input),
        tool === "delete_file" ? "targetFile" : "path",
      );
      return typeof path === "string" ? path : undefined;
    },
    concurrentSessionsAsk() {
      calls.concurrent += 1;
      return options.ask;
    },
    askedBefore(key) {
      calls.asked.push(key);
      const before = seen.has(key);
      seen.add(key);
      return before;
    },
  };
}
const allow = { status: 0, stdout: "", stderr: "" };
const forcePushMessage =
  "block-force-push: refused. Force push rewrites the remote branch. Ask the user to run it, or merge without rewriting history (PRs are squash merged, docs/adr/0004).";
const iweNormalizeMessage =
  "block-iwe-normalize: refused. `iwe normalize` rewrites every document under docs/ (docs/adr/0006). Edit files directly instead; see docs/knowledge/documentation-authoring.md.";
const ask = { key: "self a", reason: "Other Kiro sessions are running" };
const askOutput = `${JSON.stringify({
  hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: ask.reason },
})}\n`;

describe("preToolUse: force push", () => {
  it.each(["execute_bash", "shell"])(
    "refuses a force push from %s with exit 2 and the reason on stderr",
    (tool) => {
      expect(preToolUse(shell("git push -f", tool), {}, deps())).toEqual({
        status: 2,
        stdout: "",
        stderr: `${forcePushMessage}\n`,
      });
    },
  );

  it("allows an ordinary push", () => {
    expect(preToolUse(shell("git push"), {}, deps())).toEqual(allow);
  });

  it("allows a force push with KIRO_ALLOW_FORCE_PUSH=1", () => {
    expect(preToolUse(shell("git push -f"), { KIRO_ALLOW_FORCE_PUSH: "1" }, deps())).toEqual(allow);
  });

  it("does not look at a tool that is not the shell", () => {
    expect(preToolUse(write("fs_write", "git push -f"), {}, deps())).toEqual(allow);
  });
});

describe("preToolUse: iwe normalize", () => {
  it("refuses the subcommand from the shell", () => {
    expect(preToolUse(shell("iwe normalize"), {}, deps())).toEqual({
      status: 2,
      stdout: "",
      stderr: `${iweNormalizeMessage}\n`,
    });
  });

  it("refuses the iwe MCP tool", () => {
    const event = { tool_name: "@iwe/iwe_normalize", tool_input: {} };
    expect(preToolUse(event, {}, deps()).status).toBe(2);
  });

  it("allows both with IWE_ALLOW_NORMALIZE=1", () => {
    const env = { IWE_ALLOW_NORMALIZE: "1" };
    expect(preToolUse(shell("iwe normalize"), env, deps())).toEqual(allow);
    expect(preToolUse({ tool_name: "@iwe/iwe_normalize" }, env, deps())).toEqual(allow);
  });

  it("gives every reason when a command does both", () => {
    expect(preToolUse(shell("git push -f; iwe normalize"), {}, deps())).toEqual({
      status: 2,
      stdout: "",
      stderr: `${forcePushMessage}\n${iweNormalizeMessage}\n`,
    });
  });

  it("does not look at a tool outside its matcher", () => {
    expect(preToolUse({ tool_name: "fs_write_iwe_normalize" }, {}, deps()).status).toBe(0);
  });
});

describe("preToolUse: generated files", () => {
  it.each(["fs_write", "str_replace", "fs_append"])("refuses %s on a generated file", (tool) => {
    const result = preToolUse(write(tool, "pnpm-lock.yaml"), {}, deps());
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      new RegExp(
        `^block-generated-writes: refused ${tool} on pnpm-lock.yaml\\. .*pnpm install.*\\n$`,
      ),
    );
  });

  it("refuses delete_file, which names the file targetFile", () => {
    const event = { tool_name: "delete_file", tool_input: { targetFile: "skills-lock.json" } };
    expect(preToolUse(event, {}, deps()).stderr).toContain("pnpm dlx skills update");
  });

  it("allows another file", () => {
    expect(preToolUse(write("fs_write", "README.md"), {}, deps())).toEqual(allow);
  });

  it("allows a write the hook cannot place", () => {
    expect(preToolUse({ tool_name: "fs_write", tool_input: {} }, {}, deps())).toEqual(allow);
  });

  it("allows a generated file with KIRO_ALLOW_GENERATED_WRITE=1", () => {
    const env = { KIRO_ALLOW_GENERATED_WRITE: "1" };
    expect(preToolUse(write("fs_write", "pnpm-lock.yaml"), env, deps())).toEqual(allow);
  });

  it("does not resolve the path of a read or of a tool with a similar name", () => {
    const d = deps();
    preToolUse(write("read_file", "pnpm-lock.yaml"), {}, d);
    preToolUse(write("fs_write2", "pnpm-lock.yaml"), {}, d);
    preToolUse(write("xfs_write", "pnpm-lock.yaml"), {}, d);
    expect(d.calls.targets).toEqual([]);
  });
});

describe("preToolUse: concurrent sessions", () => {
  it.each([
    "execute_bash",
    "shell",
    "fs_write",
    "fsWrite",
    "str_replace",
    "strReplace",
    "fs_append",
    "fsAppend",
    "delete_file",
    "deleteFile",
    "write",
  ])("asks the user before %s when another session works here", (tool) => {
    expect(preToolUse({ tool_name: tool, tool_input: {} }, {}, deps({ ask }))).toEqual({
      status: 0,
      stdout: askOutput,
      stderr: "",
    });
  });

  it("asks once for the same key", () => {
    const d = deps({ ask, asked: [ask.key] });
    expect(preToolUse(shell("ls"), {}, d)).toEqual(allow);
    expect(d.calls.asked).toEqual([ask.key]);
  });

  it("is silent when no other session works here", () => {
    const d = deps();
    expect(preToolUse(shell("ls"), {}, d)).toEqual(allow);
    expect(d.calls.asked).toEqual([]);
  });

  it("does not look for sessions before a tool outside its matcher", () => {
    const d = deps({ ask });
    expect(preToolUse({ tool_name: "@iwe/iwe_find" }, {}, d)).toEqual(allow);
    expect(d.calls.concurrent).toBe(0);
  });

  it("does not spend the question on a tool call that is refused anyway", () => {
    const d = deps({ ask });
    expect(preToolUse(shell("git push -f"), {}, d).status).toBe(2);
    expect(d.calls.concurrent).toBe(0);
  });
});

describe("preToolUseMatcher", () => {
  const matcher = new RegExp(preToolUseMatcher);
  it.each([
    "shell",
    "execute_bash",
    "@iwe/iwe_normalize",
    "fs_write",
    "fsWrite",
    "str_replace",
    "strReplace",
    "fs_append",
    "fsAppend",
    "delete_file",
    "deleteFile",
    "write",
  ])("starts the hook for %s, which a check looks at", (tool) => {
    expect(matcher.test(tool)).toBe(true);
  });

  it.each(["read_file", "grep_search", "list_directory", "code", "web_fetch"])(
    "does not start it for %s",
    (tool) => {
      expect(matcher.test(tool)).toBe(false);
    },
  );
});

describe("preToolUse: an event it cannot read", () => {
  it.each([
    undefined,
    null,
    "text",
    1,
    [],
    {},
    { tool_name: 1 },
    { tool_name: "execute_bash" },
    { tool_name: "execute_bash", tool_input: { command: 1 } },
  ])("allows %j", (event) => {
    expect(preToolUse(event, {}, deps())).toEqual(allow);
  });
});
