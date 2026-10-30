// Reads a session record of Kiro (~/.kiro/sessions/<workspace hash>/<session>/messages.jsonl) for the manual
// check of the agent rules (docs/tooling/agent-permissions.md ("規則を変えたときの手元の確認")).
// Checked on Kiro 2.34.0: a `tool_call` record repeats for one call as its status changes, so the last one counts;
// a rule that denies a call leaves `_meta.kiro.policyDenial` on it; a `pending_interaction` is a request for
// confirmation, which a non-interactive run refuses.
import { isObject, type JsonObject } from "../checks/json.ts";

type Verdict = "allow" | "deny" | "blocked" | "ask-refused" | "ask-approved" | "failed";

export interface Call {
  readonly tool: string;
  // The command, the path or the title: what the call was about.
  readonly target: string;
  readonly status: string;
  readonly verdict: Verdict;
  // The rule that denied the call, as JSON.
  readonly rule?: string;
}

const object = (value: unknown): JsonObject => (isObject(value) ? value : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function verdictOf(status: string, denied: boolean, asked: boolean): Verdict {
  if (denied) return "deny";
  if (asked) return status === "denied" ? "ask-refused" : "ask-approved";
  // Denied with no rule of the agent and no confirmation: a hook or the user stopped it.
  if (status === "denied") return "blocked";
  return status === "failed" ? "failed" : "allow";
}

// One line of at most 120 characters.
const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 120);

// The calls of a session in the order they started. Lines that are not JSON are skipped.
export function calls(jsonl: string): Call[] {
  const asked = new Set<string>();
  const last = new Map<string, JsonObject>();
  for (const line of jsonl.split("\n")) {
    let payload: JsonObject;
    try {
      payload = object(object(JSON.parse(line)).payload);
    } catch {
      continue;
    }
    const id = text(payload.toolCallId);
    if (payload.type === "pending_interaction") asked.add(id);
    else if (payload.type === "tool_call") last.set(id, payload);
  }
  return [...last].map(([id, payload]) => {
    const args = object(payload.args);
    const denial = object(object(object(payload._meta).kiro).policyDenial);
    const status = text(payload.status);
    // Stryker disable next-line ConditionalExpression: equivalent, JSON.stringify(undefined) is undefined too.
    const rule = denial.matchedRule === undefined ? undefined : JSON.stringify(denial.matchedRule);
    return {
      tool: text(payload.toolName),
      target: oneLine(text(args.command) || text(args.path) || text(payload.title)),
      status,
      verdict: verdictOf(status, Object.keys(denial).length > 0, asked.has(id)),
      ...(rule === undefined ? {} : { rule }),
    };
  });
}

export function format(list: readonly Call[]): string {
  return list
    .map(
      (call) =>
        `${call.verdict.padEnd(12)} ${call.tool} ${call.target}${call.rule === undefined ? "" : `  [${call.rule}]`}\n`,
    )
    .join("");
}

// Whether a session.json is a session of the workspace.
export function inWorkspace(sessionJson: string, workspace: string): boolean {
  try {
    const paths = object(JSON.parse(sessionJson)).workspacePaths;
    return Array.isArray(paths) && paths.includes(workspace);
  } catch {
    return false;
  }
}
