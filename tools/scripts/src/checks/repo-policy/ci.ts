// Checks of the CI workflows and the ruleset of main: every job is needed by main, every required check runs, every Nx target has a command in the docs.
import { Tree, isRecord, list, record, text } from "./tree.ts";

// `main` in ci.yml is the required status check (.github/rulesets/protect-main.json) and collects the other jobs.
// A job that `main` does not need can fail without blocking a merge (docs/tooling/ci.md ("ci.yml の検証")).
// `needs` is a job id or a list of them (GitHub Docs, workflow syntax, `jobs.<job_id>.needs`).
export function mainNeedsEveryJob(tree: Tree): string[] {
  const ci = ".github/workflows/ci.yml";
  if (tree.repo.read(ci) === undefined)
    return [
      `${ci} does not exist. Its main job is the required status check (docs/tooling/ci.md ("ci.yml の検証")).`,
    ];
  const jobs = record(record(tree.parsed(ci)).jobs);
  const needs = record(jobs.main).needs;
  const needed = new Set(Array.isArray(needs) ? needs : [needs]);
  return Object.keys(jobs)
    .filter((job) => job !== "main" && !needed.has(job))
    .map(
      (job) =>
        `${ci}: the main job must list \`${job}\` in its needs, or a failure of \`${job}\` will not block a merge (docs/tooling/ci.md ("ci.yml の検証")).`,
    );
}

export const ruleset = ".github/rulesets/protect-main.json";

export const rules = (tree: Tree): Record<string, unknown>[] =>
  list(record(tree.parsed(ruleset)).rules).map(record);

// The contexts of a required_status_checks rule. An entry without one is skipped.
export const contexts = (rule: Record<string, unknown>): string[] =>
  list(record(rule.parameters).required_status_checks).flatMap(
    (check) => text(record(check).context) ?? [],
  );

const requiredChecks = (tree: Tree): string[] =>
  rules(tree)
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap(contexts);

// Whether a workflow runs on pull_request. `on` is an event, a list of them, or a map with one key per event
// (GitHub Docs, workflow syntax, `on`).
const onPullRequest = (on: unknown): boolean =>
  on === "pull_request" ||
  list(on).includes("pull_request") ||
  (isRecord(on) && "pull_request" in on);

const workflowFile = /^\.github\/workflows\/[^/]+\.ya?ml$/;

// Each required check is reported by a job of a workflow that runs on pull_request, or every pull request
// waits for it. A job's check carries the job's `name`, the name GitHub shows for the job (GitHub Docs,
// workflow syntax, `jobs.<job_id>.name`), or its id when it has none. A matrix job adds its matrix values
// to the name, which this does not model; no workflow here has one.
export function requiredChecksRun(tree: Tree): string[] {
  const jobs = new Set<string>();
  for (const path of tree.paths.filter((p) => workflowFile.test(p))) {
    const workflow = record(tree.parsed(path));
    if (!onPullRequest(workflow.on)) continue;
    for (const [id, job] of Object.entries(record(workflow.jobs)))
      jobs.add(text(record(job).name) ?? id);
  }
  return requiredChecks(tree)
    .filter((check) => !jobs.has(check))
    .map(
      (check) =>
        `${ruleset} requires the check "${check}", but no job of a workflow that runs on pull_request has that name, so a pull request waits for it forever (docs/tooling/ci.md ("ci.yml の job")).`,
    );
}

// The Nx targets of `nx affected` and `nx run-many` in a command of ci.yml: the names after -t or --targets
// (`-t a b`, `--targets=a,b`), which may follow other flags. A word that is not a flag ends the command.
const ciTargets = (command: string): string[] =>
  [
    ...command.matchAll(
      /\bnx (?:affected|run-many)(?: -\S+)* (?:-t|--targets)[ =](\w[\w-]*(?:[ ,]\w[\w-]*)*)/g,
    ),
  ].flatMap((match) => String(match[1]).split(/[ ,]/));

// Every Nx target that ci.yml runs has a command in docs/tooling/commands.md, so a person can run the same check
// before pushing (docs/tooling/ci.md ("検査を足すとき"), step 6). A target counts when it is a word of an inline code
// span that also has the word nx: `nx affected -t a`, `nx a api`, `nx run api:a`. The backticks pair within a line,
// so the fence of a code block does not pair with those of the inline code.
export function ciTargetsHaveCommands(tree: Tree): string[] {
  const ci = ".github/workflows/ci.yml";
  const commands = "docs/tooling/commands.md";
  const inCi = new Set<string>();
  for (const job of Object.values(record(record(tree.parsed(ci)).jobs)))
    for (const step of list(record(job).steps).map(record))
      for (const target of ciTargets(String(step.run))) inCi.add(target);
  const documented = new Set(
    tree
      .read(commands)
      .split("\n")
      .flatMap((line) => line.split("`").filter((_, index) => index % 2 === 1))
      .map((span) => span.split(/[\s:,=]/))
      .filter((words) => words.includes("nx"))
      .flat(),
  );
  return [...inCi]
    .filter((target) => !documented.has(target))
    .map(
      (target) =>
        `${ci} runs the Nx target ${target}, but ${commands} has no nx command that runs it. Add the command a person runs to its table (docs/tooling/ci.md ("検査を足すとき")).`,
    );
}
