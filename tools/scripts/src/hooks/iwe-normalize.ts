// block-iwe-normalize: refuse `iwe normalize` (docs/adr/0006). normalize rewrites every document under
// docs/ into IWE's Markdown style, which conflicts with oxfmt.
// Two paths: a shell command that runs `iwe ... normalize` in command position (shell-command.ts), and an
// iwe MCP tool named for normalize.
import { inCommandPosition } from "./shell-command.ts";

// `iwe [-opt [arg]]... normalize`, also by path (node_modules/.bin/iwe). The subcommand position is
// matched, so `iwe find normalize` is allowed.
const iweNormalize = String.raw`(\S*/)?iwe(\s+-\S+(\s+[^-\s]\S*)?)*\s+normalize([^A-Za-z0-9_-]|$)`;
// Package runners that start iwe, besides the wrappers of shell-command.ts (`pnpm exec` ends in exec).
const runners = ["npx", "pnpx", "bunx", "dlx", "--"];

export function refusesIweCommand(command: string): boolean {
  return inCommandPosition(command, iweNormalize, runners, "i").length > 0;
}

// An iwe MCP tool: its name holds both words (@iwe/iwe_normalize, iwe::iwe_normalize).
export function refusesIweTool(toolName: string): boolean {
  return /iwe.*normalize|normalize.*iwe/i.test(toolName);
}

export const iweNormalizeMessage =
  "block-iwe-normalize: refused. `iwe normalize` rewrites every document under docs/ (docs/adr/0006). Edit files directly instead; see docs/knowledge/documentation-authoring.md.";
