// Prints the factory metrics (docs/agents/factory-metrics.md) of this repository, read from GitHub with gh.
//   node tools/scripts/src/metrics/cli.ts --since 2026-10-01 [--until 2026-10-31]
//   node tools/scripts/src/metrics/cli.ts --pr 180 --count 10
// Run it in the repository: gh fills {owner}/{repo} from the git remote. It reads the required checks from
// .github/rulesets/protect-main.json. Exit 2 for bad arguments, 1 when gh fails or the boundary is not merged.
// It reads every closed pull request, then the files, workflow runs and check runs of the ones it counts, so it
// makes a few API calls per pull request and prints its progress to stderr. What it counts is in metrics.ts.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, USAGE } from "./args.ts";
import {
  around,
  categoryOf,
  feedbackLoop,
  inPeriod,
  items,
  pushes,
  requiredChecks,
  reworked,
  toPull,
  type Merged,
  type Sample,
} from "./metrics.ts";
import { boundaryReport, periodReport } from "./report.ts";

function fail(message: string, status: number): never {
  console.error(`factory-metrics: ${message}`);
  process.exit(status);
}

const options = parseArgs(process.argv.slice(2), Date.now());
if (typeof options === "string") fail(`${options}\n${USAGE}`, 2);

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const ruleset: unknown = JSON.parse(
  readFileSync(join(root, ".github/rulesets/protect-main.json"), "utf8"),
);
const required = requiredChecks(ruleset);
if (required.length === 0)
  fail("no required status checks in .github/rulesets/protect-main.json", 1);

// All pages of a GET of the REST API. api.github.com sometimes fails with EOF (docs/agents/issue-tracker.md),
// so a failed call is tried again, three times in all.
function gh(path: string): unknown {
  for (let attempt = 1; ; attempt++) {
    try {
      const out = execFileSync("gh", ["api", "--paginate", "--slurp", path], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const pages: unknown = JSON.parse(out);
      return pages;
    } catch (error) {
      if (attempt === 3) fail(`gh api ${path} failed: ${String(error)}`, 1);
    }
  }
}

const repo = "repos/{owner}/{repo}";
const pulls = items(gh(`${repo}/pulls?state=closed&per_page=100`)).flatMap(
  (raw) => toPull(raw) ?? [],
);
const reworkedPulls = reworked(pulls);

function sample(pull: Merged): Sample {
  process.stderr.write(`factory-metrics: reading #${pull.number}\n`);
  const files = items(gh(`${repo}/pulls/${pull.number}/files?per_page=100`));
  const branch = encodeURIComponent(pull.branch);
  const runs = items(
    gh(`${repo}/actions/runs?event=pull_request&branch=${branch}&per_page=100`),
    "workflow_runs",
  );
  const loops = pushes(runs, pull).flatMap(({ sha, pushedAt }) => {
    const checkRuns = items(
      gh(`${repo}/commits/${sha}/check-runs?filter=all&per_page=100`),
      "check_runs",
    );
    const ms = feedbackLoop(pushedAt, checkRuns, required);
    return ms === undefined ? [] : [{ pushedAt, ms }];
  });
  return { pull, category: categoryOf(files), loops };
}

if (options.kind === "period") {
  const samples = inPeriod(pulls, options.since, options.until).map(sample);
  process.stdout.write(periodReport({ ...options, samples, reworked: reworkedPulls }));
} else {
  const sides = around(pulls, options.pull, options.count);
  if (sides === undefined) fail(`#${options.pull} is not a merged pull request`, 1);
  process.stdout.write(
    boundaryReport({
      boundary: sides.boundary,
      count: options.count,
      before: sides.before.map(sample),
      after: sides.after.map(sample),
      reworked: reworkedPulls,
    }),
  );
}
