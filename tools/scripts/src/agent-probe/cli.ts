// Prints what the rules of an agent did to each call of the latest Kiro session of a workspace: allow, deny
// (with the rule), ask-refused (a confirmation, which a non-interactive run refuses), ask-approved or failed.
//   node tools/scripts/src/agent-probe/cli.ts <workspace>
// Read ~/.kiro/sessions/*/*/session.json for the session whose workspacePaths has the workspace (an absolute
// path), the newest by modification time. Exit 2 for bad arguments, 1 when there is no such session.
// What it reads is in records.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { calls, format, inWorkspace } from "./records.ts";

const workspace = process.argv[2];
if (workspace === undefined || process.argv.length > 3) {
  console.error("usage: node tools/scripts/src/agent-probe/cli.ts <workspace>");
  process.exit(2);
}
const absolute = resolve(workspace);
const root = join(homedir(), ".kiro", "sessions");

const sessions = readdirSync(root, { withFileTypes: true }).flatMap((hash) =>
  hash.isDirectory()
    ? readdirSync(join(root, hash.name), { withFileTypes: true }).flatMap((session) => {
        const dir = join(root, hash.name, session.name);
        const file = join(dir, "session.json");
        try {
          return inWorkspace(readFileSync(file, "utf8"), absolute)
            ? [{ dir, time: statSync(file).mtimeMs }]
            : [];
        } catch {
          return [];
        }
      })
    : [],
);
const latest = sessions.sort((a, b) => b.time - a.time)[0];
if (latest === undefined) {
  console.error(`agent-probe: no Kiro session for ${absolute} in ${root}`);
  process.exit(1);
}
process.stdout.write(format(calls(readFileSync(join(latest.dir, "messages.jsonl"), "utf8"))));
