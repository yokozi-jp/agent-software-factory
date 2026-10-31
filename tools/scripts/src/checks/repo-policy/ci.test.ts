// The checks of CI workflows (./ci.ts), each called on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { passingRepo } from "./fixtures/passing-repo.ts";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { ciTargetsHaveCommands, mainNeedsEveryJob, requiredChecksRun } from "./ci.ts";

const base = passingRepo;

describe("every job of ci.yml is in the needs of main", () => {
  const violations = failuresOf(mainNeedsEveryJob);
  const ci = base[".github/workflows/ci.yml"] ?? "";
  const extra = `${ci}  extra:\n    runs-on: ubuntu-26.04\n    steps: []\n`;
  const notNeeded =
    '.github/workflows/ci.yml: the main job must list `extra` in its needs, or a failure of `extra` will not block a merge (docs/tooling/ci.md ("ci.yml の検証")).';

  it("refuses a job that main does not need", () => {
    expect(violations(repo({ ".github/workflows/ci.yml": extra }))).toEqual([notNeeded]);
  });

  it.each([
    ["a one-line list", "    needs: [checks, nx, extra]"],
    ["a block list", "    needs:\n      - checks\n      - nx\n      - extra"],
    ["a flow list over several lines", "    needs: [\n      checks,\n      nx, extra,\n    ]"],
  ])("reads needs written as %s", (_, needs) => {
    const ci = extra.replace("    needs: [checks, nx]", needs);
    expect(violations(repo({ ".github/workflows/ci.yml": ci }))).toEqual([]);
  });

  // The step keeps the row of the catalog in the fixture.
  const step = "    steps: [{ name: Guard push, run: x }]\n";

  it("reads needs written as a single job", () => {
    const single = `jobs:\n  build:\n${step}  main:\n    needs: build\n    steps: []\n`;
    expect(violations(repo({ ".github/workflows/ci.yml": single }))).toEqual([]);
  });

  it("refuses every job when there is no main", () => {
    const none = `jobs:\n  build:\n${step}`;
    expect(violations(repo({ ".github/workflows/ci.yml": none }))).toEqual([
      '.github/workflows/ci.yml: the main job must list `build` in its needs, or a failure of `build` will not block a merge (docs/tooling/ci.md ("ci.yml の検証")).',
    ]);
  });

  // check-repo-policy.sh stopped with an error from awk.
  it("refuses a repository without ci.yml", () => {
    expect(violations(repo({ ".github/workflows/ci.yml": undefined }))).toEqual([
      '.github/workflows/ci.yml does not exist. Its main job is the required status check (docs/tooling/ci.md ("ci.yml の検証")).',
    ]);
  });
});

describe("every required check of the ruleset is a job that runs on pull_request", () => {
  const violations = failuresOf(requiredChecksRun);
  const workflow = ".github/workflows/commitlint.yml";
  const job = "jobs:\n  commitlint:\n    steps: []\n";
  const waits = (check: string) =>
    `.github/rulesets/protect-main.json requires the check "${check}", but no job of a workflow that runs on pull_request has that name, so a pull request waits for it forever (docs/tooling/ci.md ("ci.yml の job")).`;

  it("refuses a required check that no job reports", () => {
    const renamed = "on: pull_request\njobs:\n  lint:\n    steps: []\n";
    expect(violations(repo({ [workflow]: renamed }))).toEqual([waits("commitlint")]);
  });

  it.each([
    ["only on push", "on:\n  push:\n"],
    ["on pull_request_target", "on: pull_request_target\n"],
    ["on a list without pull_request", "on: [push, workflow_dispatch]\n"],
    ["without on", ""],
  ])("refuses a job of a workflow that runs %s", (_, on) => {
    expect(violations(repo({ [workflow]: on + job }))).toEqual([waits("commitlint")]);
  });

  it.each([
    ["a string", "on: pull_request\n"],
    ["a list", "on: [push, pull_request]\n"],
    ["a map", "on:\n  pull_request:\n    types: [opened]\n"],
  ])("reads on written as %s", (_, on) => {
    expect(violations(repo({ [workflow]: on + job }))).toEqual([]);
  });

  it("matches the name of a job when it has one, as GitHub names the check", () => {
    const named = (name: string) =>
      `on: pull_request\njobs:\n  lint:\n    name: ${name}\n    steps: []\n`;
    expect(violations(repo({ [workflow]: named("commitlint") }))).toEqual([]);
    const idOnly = "on: pull_request\njobs:\n  commitlint:\n    name: Commit lint\n    steps: []\n";
    expect(violations(repo({ [workflow]: idOnly }))).toEqual([waits("commitlint")]);
  });

  it("reads the checks of a required_status_checks rule only", () => {
    const other = JSON.stringify({
      rules: [{ type: "pull_request", parameters: { required_status_checks: [{ context: "x" }] } }],
    });
    expect(violations(repo({ ".github/rulesets/protect-main.json": other }))).toEqual([]);
  });

  it("reads every workflow of .github/workflows, but not files elsewhere", () => {
    const yaml = {
      [workflow]: undefined,
      ".github/workflows/lint.yaml": `on: pull_request\n${job}`,
    };
    expect(violations(repo(yaml))).toEqual([]);
    const elsewhere = {
      [workflow]: undefined,
      ".github/workflows/old/lint.yml": `on: pull_request\n${job}`,
      ".github/workflows/lint.yml.bak": `on: pull_request\n${job}`,
      "apps/.github/workflows/lint.yml": `on: pull_request\n${job}`,
      ".github/lint.yml": `on: pull_request\n${job}`,
    };
    expect(violations(repo(elsewhere))).toEqual([waits("commitlint")]);
  });
});

describe("every Nx target that ci.yml runs has a command in docs/tooling/commands.md", () => {
  const violations = failuresOf(ciTargetsHaveCommands);
  const ci = base[".github/workflows/ci.yml"] ?? "";
  const runs = (command: string) =>
    ci.replace("run: tools/scripts/sh/guard-push.sh", `run: ${command}`);
  const commands = (...rows: string[]) =>
    ["# 開発コマンド", "", "| やりたいこと | コマンド |", "| --- | --- |", ...rows, ""].join("\n");
  const missing = (target: string) =>
    `.github/workflows/ci.yml runs the Nx target ${target}, but docs/tooling/commands.md has no nx command that runs it. Add the command a person runs to its table (docs/tooling/ci.md ("検査を足すとき")).`;

  it("refuses a target of nx affected that commands.md does not run", () => {
    expect(
      violations(
        repo({
          ".github/workflows/ci.yml": runs("pnpm exec nx affected -t check db-types-check"),
          "docs/tooling/commands.md": commands("| 検査 | `pnpm exec nx affected -t check` |"),
        }),
      ),
    ).toEqual([missing("db-types-check")]);
  });

  it.each([
    ["the -t list of nx affected", "`pnpm exec nx affected -t check db-types-check`"],
    ["the --targets list of nx run-many", "`pnpm exec nx run-many --targets=db-types-check,check`"],
    ["nx <target> <project>", "`pnpm exec nx db-types-check api` と `pnpm exec nx check api`"],
    ["nx run <project>:<target>", "`pnpm exec nx run api:db-types-check`、`nx run api:check`"],
  ])("passes targets that commands.md runs in %s", (_, cell) => {
    expect(
      violations(
        repo({
          ".github/workflows/ci.yml": runs("pnpm exec nx affected -t check db-types-check"),
          "docs/tooling/commands.md": commands(`| 検査 | ${cell} |`),
        }),
      ),
    ).toEqual([]);
  });

  it("reads the targets after other flags, after --targets with = or a space, and of every nx command", () => {
    const step = [
      "|",
      "          pnpm exec nx run-many --targets=lint-effect,mutation",
      "          pnpm exec nx affected --base=x --head=y -t test db-types-check --parallel=1 && pnpm exec nx affected --targets build",
    ].join("\n");
    expect(
      violations(
        repo({ ".github/workflows/ci.yml": runs(step), "docs/tooling/commands.md": commands() }),
      ),
    ).toEqual(["lint-effect", "mutation", "test", "db-types-check", "build"].map(missing));
  });

  it("reads the inline code after a fenced code block", () => {
    const fenced = ["```sh", "pnpm install", "```", "", "| 検査 | `pnpm exec nx check api` |", ""];
    expect(
      violations(
        repo({
          ".github/workflows/ci.yml": runs("pnpm exec nx affected -t check"),
          "docs/tooling/commands.md": fenced.join("\n"),
        }),
      ),
    ).toEqual([]);
  });

  it("finds no target in nx commands that run none", () => {
    const step =
      "pnpm exec nx show projects --affected && pnpm exec nx affected --graph && echo onx affected -t x";
    expect(
      violations(
        repo({ ".github/workflows/ci.yml": runs(step), "docs/tooling/commands.md": commands() }),
      ),
    ).toEqual([]);
  });

  it("does not count a target that commands.md names outside an nx command", () => {
    expect(
      violations(
        repo({
          ".github/workflows/ci.yml": runs("pnpm exec nx affected -t db-types-check"),
          "docs/tooling/commands.md": commands(
            "| nx で db-types-check を流す | `pnpm db-types-check` |",
          ),
        }),
      ),
    ).toEqual([missing("db-types-check")]);
  });
});
