// What the PreToolUse hook decides for one tool call: which checks apply to the tool, and what Kiro gets
// back. One process runs every check, so the shell pays for one Node start per tool call (#136).
// Kiro 2.34.0 (kas/<version>/node_modules/@kiro/agent/dist/server/acp-server.js): exit 2 refuses the
// call and stderr goes back to the agent; exit 0 with {"hookSpecificOutput":{"permissionDecision":"ask",
// ...}} on stdout asks the user first. The event JSON on stdin has tool_name (the tool id) and tool_input.
// Each check keeps the matcher its own hook had (docs/tooling/git-hooks.md ("Kiro の hook")); the matcher
// in .kiro/hooks/pre-tool-use.json is their union.
import { refusesForcePush, forcePushMessage } from "../force-push.ts";
import { generatedWriteRefusal } from "../generated-writes.ts";
import { iweNormalizeMessage, refusesIweCommand, refusesIweTool } from "../iwe-normalize.ts";

// The variables that let a refused call through for this session.
export interface PreToolUseEnv {
  readonly KIRO_ALLOW_FORCE_PUSH?: string | undefined;
  readonly IWE_ALLOW_NORMALIZE?: string | undefined;
  readonly KIRO_ALLOW_GENERATED_WRITE?: string | undefined;
}

// What needs the file system, git or the session records. cli.ts gives the real ones.
export interface PreToolUseDeps {
  // The path <tool> writes, relative to the repository root, or undefined (generated-writes.ts).
  writeTarget(tool: string, input: unknown): string | undefined;
  // The question about other sessions in this working tree, or undefined (concurrent-sessions.ts).
  concurrentSessionsAsk(): { readonly key: string; readonly reason: string } | undefined;
  // Whether <key> was asked about before; records it.
  askedBefore(key: string): boolean;
}

export interface Decision {
  readonly status: 0 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

const shellTool = /shell|execute_bash/;
// The matcher had @iwe*, a regular expression that matches "@iw" and more; the MCP tools' names start @iwe.
const iweTool = /shell|execute_bash|@iwe/;
const generatedTool = /^(fs_write|str_replace|fs_append|delete_file)$/;
const concurrentTool =
  /write|fs_write|fsWrite|str_replace|strReplace|fs_append|fsAppend|delete_file|deleteFile|shell|execute_bash/;
// The matcher of .kiro/hooks/pre-tool-use.json: the tools at least one check looks at, so Node does not
// start for the others (reads, searches). Kiro tests it as a regular expression against the tool id.
export const preToolUseMatcher =
  "shell|execute_bash|@iwe*|write|fs_write|fsWrite|str_replace|strReplace|fs_append|fsAppend|delete_file|deleteFile";

function refusals(
  tool: string,
  input: unknown,
  env: PreToolUseEnv,
  deps: PreToolUseDeps,
): string[] {
  const command: unknown = Reflect.get(Object(input), "command");
  const reasons: string[] = [];
  if (env.KIRO_ALLOW_FORCE_PUSH !== "1" && shellTool.test(tool) && typeof command === "string") {
    if (refusesForcePush(command)) reasons.push(forcePushMessage);
  }
  if (env.IWE_ALLOW_NORMALIZE !== "1" && iweTool.test(tool)) {
    if (refusesIweTool(tool) || (typeof command === "string" && refusesIweCommand(command)))
      reasons.push(iweNormalizeMessage);
  }
  if (env.KIRO_ALLOW_GENERATED_WRITE !== "1" && generatedTool.test(tool)) {
    const rel = deps.writeTarget(tool, input);
    const reason = rel === undefined ? undefined : generatedWriteRefusal(tool, rel);
    if (reason !== undefined) reasons.push(reason);
  }
  return reasons;
}

// <event> is the parsed stdin. Anything it cannot read is allowed (fail-open, as each hook was).
export function preToolUse(event: unknown, env: PreToolUseEnv, deps: PreToolUseDeps): Decision {
  const allow: Decision = { status: 0, stdout: "", stderr: "" };
  // A tool name that is missing or not a string reads as one that no check looks at ("undefined").
  const tool = String(Reflect.get(Object(event), "tool_name"));
  const reasons = refusals(tool, Reflect.get(Object(event), "tool_input"), env, deps);
  if (reasons.length > 0)
    return { status: 2, stdout: "", stderr: reasons.map((reason) => `${reason}\n`).join("") };
  // A refused call does not run, so it does not need the question; it is asked at the next call.
  if (!concurrentTool.test(tool)) return allow;
  const ask = deps.concurrentSessionsAsk();
  if (ask === undefined || deps.askedBefore(ask.key)) return allow;
  const output = {
    hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: ask.reason },
  };
  return { status: 0, stdout: `${JSON.stringify(output)}\n`, stderr: "" };
}
