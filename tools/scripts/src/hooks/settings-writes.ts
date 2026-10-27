// block-settings-writes: refuse edits of .kiro/settings/ by the file tools. The settings hold the default
// agent, the MCP servers and their disabled tools; the agent must not loosen the guardrails that guard it
// without a PR (docs/tooling/agent-permissions.md). .kiro/agents/ and .kiro/hooks/ are "確認" there: the
// agent's rules ask the user before a write.
// Not covered: shell redirects and commands (`>`, `tee`, `cp`), as in generated-writes.ts. A change still
// goes through a PR, which the ruleset puts under review.

// The refusal for <tool> writing <rel> (relative to the repository root), or undefined to allow it.
export function settingsWriteRefusal(tool: string, rel: string): string | undefined {
  if (rel !== ".kiro/settings" && !rel.startsWith(".kiro/settings/")) return undefined;
  return `block-settings-writes: refused ${tool} on ${rel}. .kiro/settings/ sets the default agent and the MCP servers, which the agent's guardrails depend on. Do not edit it; describe the change you need in the PR or ask the user to make it (docs/tooling/agent-permissions.md).`;
}
