// GitHub REST API responses for the tests of the factory metrics, in the shape gh api prints them. Only the
// fields metrics.ts reads, plus a few it must ignore. Shapes: GET /repos/{owner}/{repo}/pulls,
// .../pulls/{n}/files, .../actions/runs, .../commits/{sha}/check-runs, as of 2026-10.

const ACTIONS_APP = 15368;

export interface PullFields {
  readonly title?: string;
  readonly body?: string | null;
  readonly login?: string;
  readonly labels?: readonly string[];
  readonly branch?: string;
  readonly createdAt?: string;
  readonly mergedAt?: string | null;
}

// A pull request of GET /repos/{owner}/{repo}/pulls?state=closed. Renovate's login is renovate[bot], of type Bot.
export const pull = (number: number, fields: PullFields = {}) => {
  const login = fields.login ?? "yokozi-jp";
  return {
    number,
    state: "closed",
    title: fields.title ?? `docs: change ${number}`,
    body: fields.body === undefined ? null : fields.body,
    user: { login, type: login.endsWith("[bot]") ? "Bot" : "User" },
    labels: (fields.labels ?? []).map((name) => ({ id: name.length, name, color: "ededed" })),
    head: { ref: fields.branch ?? `branch-${number}`, sha: `head-${number}` },
    created_at: fields.createdAt ?? "2026-10-01T00:00:00Z",
    merged_at: fields.mergedAt === undefined ? "2026-10-02T00:00:00Z" : fields.mergedAt,
  };
};

// A file of GET /repos/{owner}/{repo}/pulls/{n}/files. A renamed file has previous_filename.
export const file = (filename: string, previousFilename?: string) => ({
  filename,
  status: previousFilename === undefined ? "modified" : "renamed",
  additions: 3,
  deletions: 1,
  ...(previousFilename === undefined ? {} : { previous_filename: previousFilename }),
});

// A workflow run of GET /repos/{owner}/{repo}/actions/runs.
export const run = (headSha: string, createdAt: string, event = "pull_request") => ({
  name: "CI",
  event,
  head_sha: headSha,
  created_at: createdAt,
  run_attempt: 1,
  status: "completed",
  conclusion: "success",
  pull_requests: [],
});

// A check run of GET /repos/{owner}/{repo}/commits/{sha}/check-runs. completedAt is null while it runs.
export const checkRun = (
  name: string,
  completedAt: string | null,
  conclusion: string | null = "success",
  app = ACTIONS_APP,
) => ({
  name,
  status: completedAt === null ? "in_progress" : "completed",
  conclusion,
  started_at: "2026-10-01T00:00:00Z",
  completed_at: completedAt,
  app: { id: app, slug: app === ACTIONS_APP ? "github-actions" : "other" },
});

// The ruleset of .github/rulesets/protect-main.json, with the required checks given ({ context, integration_id }).
export const ruleset = (checks: readonly Record<string, unknown>[]) => ({
  name: "protect-main",
  rules: [
    { type: "deletion" },
    { type: "pull_request", parameters: { allowed_merge_methods: ["squash"] } },
    {
      type: "required_status_checks",
      parameters: { strict_required_status_checks_policy: false, required_status_checks: checks },
    },
  ],
});
