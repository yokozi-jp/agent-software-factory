// Process tests for the factory metrics entry point: argv, the ruleset of the repository and the gh calls, to
// exit code and output. gh is a stub that prints the fixture written for each API path; nothing calls GitHub.
// What is counted and printed is in metrics.test.ts and report.test.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { stubDir, withPath } from "../test/stubs.ts";
import { checkRun, file, pull, ruleset, run } from "./fixtures/github.ts";

const cli = join(import.meta.dirname, "cli.ts");

let box: Sandbox;
let fixtures: string;
let path: string;

// The file the stub gh prints for an API path: the path with every character but letters and digits as "_".
const fixtureFile = (apiPath: string): string =>
  join(fixtures, apiPath.replace(/[^A-Za-z0-9]/g, "_"));
// What `gh api --paginate --slurp` prints: an array of the pages.
const respond = (apiPath: string, ...pages: unknown[]): void => {
  writeFileSync(fixtureFile(apiPath), JSON.stringify(pages));
};

const metrics = (...args: string[]) =>
  runIn(box.root, process.execPath, [cli, ...args], { env: { PATH: path, FIXTURES: fixtures } });

const repo = "repos/{owner}/{repo}";

beforeAll(() => {
  box = sandbox();
  gitIn(box.root, ["init", "-q"]);
  mkdirSync(join(box.root, ".github/rulesets"), { recursive: true });
  writeFileSync(
    join(box.root, ".github/rulesets/protect-main.json"),
    JSON.stringify(ruleset([{ context: "main", integration_id: 15368 }])),
  );
  fixtures = join(box.root, "fixtures");
  mkdirSync(fixtures);
  // gh api --paginate --slurp <path>: $4 is the path.
  const gh = [
    'f="$FIXTURES/$(printf %s "$4" | tr -c "A-Za-z0-9" "_")"',
    'if [ "$1 $2 $3" = "api --paginate --slurp" ] && [ -f "$f" ]; then cat "$f"; exit 0; fi',
    'echo "gh stub: no fixture for $*" >&2',
    "exit 1",
  ].join("\n");
  path = withPath(stubDir(box.root, "bin", { gh }));
});
afterAll(() => {
  box.remove();
});

describe("factory-metrics", () => {
  it("is a usage error without a period or a boundary", () => {
    const result = metrics();
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      "factory-metrics: give --since, or --pr and --count\n" +
        "usage: node tools/scripts/src/metrics/cli.ts --since YYYY-MM-DD [--until YYYY-MM-DD]\n" +
        "       node tools/scripts/src/metrics/cli.ts --pr <number> --count <N>\n",
    );
  });

  it("fails, after trying again, when gh fails", () => {
    const result = metrics("--since", "2026-10-01");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      `factory-metrics: gh api ${repo}/pulls?state=closed&per_page=100 failed:`,
    );
  });

  it("prints the metrics of a period from the API responses", () => {
    respond(
      `${repo}/pulls?state=closed&per_page=100`,
      [
        pull(1, {
          title: "ci: x",
          createdAt: "2026-10-01T00:00:00Z",
          mergedAt: "2026-10-02T00:00:00Z",
        }),
        pull(2, { login: "renovate[bot]", mergedAt: "2026-10-02T00:00:00Z" }),
      ],
      [pull(3, { mergedAt: "2026-10-03T00:00:00Z", body: "直す PR: #1" })],
    );
    respond(`${repo}/pulls/1/files?per_page=100`, [file("README.md")]);
    respond(`${repo}/pulls/3/files?per_page=100`, [file("apps/api/src/app.ts")]);
    respond(`${repo}/actions/runs?event=pull_request&branch=branch-1&per_page=100`, {
      workflow_runs: [run("a", "2026-10-01T00:00:03Z")],
    });
    respond(`${repo}/actions/runs?event=pull_request&branch=branch-3&per_page=100`, {
      workflow_runs: [],
    });
    respond(`${repo}/commits/a/check-runs?filter=all&per_page=100`, {
      check_runs: [checkRun("main", "2026-10-01T00:02:03Z")],
    });

    const result = metrics("--since", "2026-10-01", "--until", "2026-10-31");
    expect(result.stderr).toBe("factory-metrics: reading #1\nfactory-metrics: reading #3\n");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| first-pass acceptance | 100% (1/1) | 100% (1/1) |\n");
    expect(result.stdout).toContain("| 手戻りの割合 | 0% (0/1) | 100% (1/1) |\n");
    expect(result.stdout).toContain("- 2026-10-02 #1 ci: x\n");
    expect(result.stdout).toContain("| 2026-09-28 | — | 中央値 2.0 分、p90 2.0 分 (push 1) |\n");
  });

  it("fails for a boundary that is not a merged pull request", () => {
    const result = metrics("--pr", "4", "--count", "2");
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("factory-metrics: #4 is not a merged pull request\n");
  });

  it("prints the metrics before and after a boundary", () => {
    const result = metrics("--pr", "2", "--count", "5");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# 工場の成果の指標: #2 の前後 5 件\n");
    expect(result.stdout).toContain("## #2 より後 (2026-10-03 から 2026-10-03 に merge)\n");
  });
});
