// Prints the PRs that a Renovate local run (scripts/renovate.sh preview) would open.
// Input: the JSON log of `renovate --platform=local` at trace level, as a file path.
import { readFileSync } from "node:fs";

const [, , logFile] = process.argv;
if (!logFile) {
  console.error("usage: node scripts/renovate-preview.mjs <renovate log file>");
  process.exit(2);
}

const entries = readFileSync(logFile, "utf8")
  .split("\n")
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

// Renovate logs the final list of branches once, with the title each PR would get.
const branches = entries.findLast((entry) => entry.msg === "branches")?.branches;
if (!branches) {
  console.error("renovate-preview: no branch list in the log. Did the run reach the branch step?");
  process.exit(1);
}

for (const branch of branches) {
  console.log(`${branch.branchName}\n  ${branch.prTitle}`);
  // A dependency used in several files is listed once per file in the log.
  const rows = new Set();
  for (const upgrade of branch.upgrades ?? []) {
    if (!upgrade.depName) continue;
    const from = upgrade.currentVersion ?? upgrade.currentValue ?? "?";
    const to = upgrade.newVersion ?? upgrade.newValue ?? "?";
    rows.add(`    ${upgrade.depName}: ${from} -> ${to} (${upgrade.updateType})`);
  }
  for (const row of rows) console.log(row);
}
console.log(`\n${branches.length} branch(es)`);
