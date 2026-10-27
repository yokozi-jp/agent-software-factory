// What the PreToolUse hook decides for one tool call: which checks apply to the tool, and what Kiro gets
// back. One process runs every check, so the shell pays for one Node start per tool call (#136).
// Kiro 2.34.0 (kas/<version>/node_modules/@kiro/agent/dist/server/acp-server.js): exit 2 refuses the
// call and stderr goes back to the agent. The event JSON on stdin has tool_name (the tool id) and
// tool_input. Other Kiro sessions in this working tree are only warned about at SessionStart (#191).
// Each check keeps the matcher its own hook had (docs/tooling/git-hooks.md ("Kiro の hook")); the matcher
// in .kiro/hooks/pre-tool-use.json is their union.
import { forbiddenCommand } from "../forbidden-commands.ts";
import { refusesForcePush, forcePushMessage } from "../force-push.ts";
import { generatedWriteRefusal } from "../generated-writes.ts";
import { iweNormalizeMessage, refusesIweCommand, refusesIweTool } from "../iwe-normalize.ts";
import { settingsWriteRefusal } from "../settings-writes.ts";

// The variables that let a refused call through for this session.
export interface PreToolUseEnv {
  readonly KIRO_ALLOW_FORCE_PUSH?: string | undefined;
  readonly IWE_ALLOW_NORMALIZE?: string | undefined;
  readonly KIRO_ALLOW_GENERATED_WRITE?: string | undefined;
}

// What needs the file system or git. cli.ts gives the real one.
export interface PreToolUseDeps {
  // The path <tool> writes, relative to the repository root, or undefined (generated-writes.ts).
  writeTarget(tool: string, input: unknown): string | undefined;
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
// The matcher of .kiro/hooks/pre-tool-use.json: the tools at least one check looks at, so Node does not
// start for the others (reads, searches). Kiro tests it as a regular expression against the tool id.
export const preToolUseMatcher =
  "shell|execute_bash|@iwe*|fs_write|str_replace|fs_append|delete_file";

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
  // No variable lets a forbidden command through: the user runs it themselves (docs/tooling/agent-permissions.md).
  const forbidden =
    shellTool.test(tool) && typeof command === "string" ? forbiddenCommand(command) : undefined;
  if (forbidden !== undefined) reasons.push(forbidden);
  if (generatedTool.test(tool)) {
    const rel = deps.writeTarget(tool, input);
    const generated =
      env.KIRO_ALLOW_GENERATED_WRITE === "1" || rel === undefined
        ? undefined
        : generatedWriteRefusal(tool, rel);
    if (generated !== undefined) reasons.push(generated);
    const settings = rel === undefined ? undefined : settingsWriteRefusal(tool, rel);
    if (settings !== undefined) reasons.push(settings);
  }
  return reasons;
}

// <event> is the parsed stdin. Anything it cannot read is allowed (fail-open, as each hook was).
export function preToolUse(event: unknown, env: PreToolUseEnv, deps: PreToolUseDeps): Decision {
  const allow: Decision = { status: 0, stdout: "", stderr: "" };
  // A tool name that is missing or not a string reads as one that no check looks at ("undefined").
  const tool = String(Reflect.get(Object(event), "tool_name"));
  const reasons = refusals(tool, Reflect.get(Object(event), "tool_input"), env, deps);
  if (reasons.length === 0) return allow;
  return { status: 2, stdout: "", stderr: reasons.map((reason) => `${reason}\n`).join("") };
}
