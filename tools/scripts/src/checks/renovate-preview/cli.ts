// Prints the PRs that a Renovate local run (scripts/renovate.sh preview) would open.
//   node tools/scripts/src/checks/renovate-preview/cli.ts <renovate log file>
// The log is the JSON log of `renovate --platform=local` at trace level. Exit 2 without a file, 1 when the
// log has no branch list. What is listed is in rules.ts.
import { readFileSync } from "node:fs";
import { preview } from "./rules.ts";

const logFile = process.argv[2];
if (logFile === undefined) {
  console.error("usage: node tools/scripts/src/checks/renovate-preview/cli.ts <renovate log file>");
  process.exit(2);
}
const output = preview(readFileSync(logFile, "utf8"));
if (output === undefined) {
  console.error("renovate-preview: no branch list in the log. Did the run reach the branch step?");
  process.exit(1);
}
process.stdout.write(output);
