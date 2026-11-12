// The PRs that a Renovate local run would open (tools/scripts/sh/renovate.sh preview, docs/tooling/renovate.md).
// Pure function; cli.ts reads the log file and prints what this returns.
import { isObject, objects } from "../json.ts";

// A log line that is not JSON (Renovate's own output between the entries) gives undefined.
// Stryker disable BlockStatement: equivalent, an empty catch also gives undefined.
function parse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
// Stryker restore BlockStatement

// Renovate logs names, versions and titles as strings.
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

// The first value that is a string; "?" when there is none.
const first = (...values: unknown[]): string =>
  values.map(text).find((value) => value !== undefined) ?? "?";

// "automerge: yes" when Renovate would merge the PR itself, with the release age it waits for; "automerge: no" otherwise.
function automergeLine(branch: Record<string, unknown>): string {
  if (branch.automerge !== true) return "  automerge: no";
  const ages = new Set(
    objects(branch.upgrades)
      .map((upgrade) => text(upgrade.minimumReleaseAge))
      .filter((age) => age !== undefined),
  );
  return ages.size === 0
    ? "  automerge: yes"
    : `  automerge: yes (minimumReleaseAge ${[...ages].join(", ")})`;
}

// Whether a line of the log may be the branch list, judged without parsing it. cli.ts uses this to keep only those
// lines of a log that is too large to hold; preview() then parses them and checks `msg` itself.
export const isBranchListLine = (line: string): boolean => line.includes('"msg":"branches"');

// Input: the JSON log of `renovate --platform=local` at trace level, one entry per line.
// Renovate logs the final list of branches once, with the title each PR would get; the last such entry
// is read. Returns undefined when the log has none (the run did not reach the branch step).
export function preview(log: string): string | undefined {
  const entries = log.split("\n").map(parse).filter(isObject);
  const list = entries.findLast((entry) => entry.msg === "branches")?.branches;
  if (!Array.isArray(list)) return undefined;
  const branches = objects(list);

  const out: string[] = [];
  for (const branch of branches) {
    out.push(`${String(branch.branchName)}\n  ${String(branch.prTitle)}\n${automergeLine(branch)}`);
    // A dependency used in several files is listed once per file in the log.
    const rows = new Set<string>();
    for (const upgrade of objects(branch.upgrades)) {
      const name = text(upgrade.depName);
      if (!name) continue;
      const from = first(upgrade.currentVersion, upgrade.currentValue);
      const to = first(upgrade.newVersion, upgrade.newValue);
      rows.add(`    ${name}: ${from} -> ${to} (${String(upgrade.updateType)})`);
    }
    out.push(...rows);
  }
  out.push(`\n${branches.length} branch(es)`);
  return out.map((line) => `${line}\n`).join("");
}
