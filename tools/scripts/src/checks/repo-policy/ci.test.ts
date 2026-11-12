// The checks of CI workflows (./ci.ts), each called alone on a small repository held in memory:
// a case breaks one file of a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { passingRepo } from "./fixtures/passing-repo.ts";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { ciTargetsHaveCommands, mainNeedsEveryJob, requiredChecksRun } from "./ci.ts";

const base = passingRepo;

describe("ci.yml のすべての job が main の needs にあること", () => {
  const violations = failuresOf(mainNeedsEveryJob);
  const ci = base[".github/workflows/ci.yml"] ?? "";
  const extra = `${ci}  extra:\n    runs-on: ubuntu-26.04\n    steps: []\n`;
  const notNeeded =
    '.github/workflows/ci.yml: the main job must list `extra` in its needs, or a failure of `extra` will not block a merge (docs/tooling/ci.md ("ci.yml の検証")).';

  it("main が needs にしない job を拒否すること", () => {
    expect(violations(repo({ ".github/workflows/ci.yml": extra }))).toEqual([notNeeded]);
  });

  it.each([
    ["a one-line list", "    needs: [checks, nx, extra]"],
    ["a block list", "    needs:\n      - checks\n      - nx\n      - extra"],
    ["a flow list over several lines", "    needs: [\n      checks,\n      nx, extra,\n    ]"],
  ])("%s と書いた needs を読むこと", (_, needs) => {
    const ci = extra.replace("    needs: [checks, nx]", needs);
    expect(violations(repo({ ".github/workflows/ci.yml": ci }))).toEqual([]);
  });

  // The step keeps the row of the catalog in the fixture.
  const step = "    steps: [{ name: Guard push, run: x }]\n";

  it("単一の job と書いた needs を読むこと", () => {
    const single = `jobs:\n  build:\n${step}  main:\n    needs: build\n    steps: []\n`;
    expect(violations(repo({ ".github/workflows/ci.yml": single }))).toEqual([]);
  });

  it("main がないとき、すべての job を拒否すること", () => {
    const none = `jobs:\n  build:\n${step}`;
    expect(violations(repo({ ".github/workflows/ci.yml": none }))).toEqual([
      '.github/workflows/ci.yml: the main job must list `build` in its needs, or a failure of `build` will not block a merge (docs/tooling/ci.md ("ci.yml の検証")).',
    ]);
  });

  // check-repo-policy.sh stopped with an error from awk.
  it("ci.yml のないリポジトリを拒否すること", () => {
    expect(violations(repo({ ".github/workflows/ci.yml": undefined }))).toEqual([
      '.github/workflows/ci.yml does not exist. Its main job is the required status check (docs/tooling/ci.md ("ci.yml の検証")).',
    ]);
  });
});

describe("ruleset のすべての必須チェックが、pull_request で動く job であること", () => {
  const violations = failuresOf(requiredChecksRun);
  const workflow = ".github/workflows/commitlint.yml";
  const job = "jobs:\n  commitlint:\n    steps: []\n";
  const waits = (check: string) =>
    `.github/rulesets/protect-main.json requires the check "${check}", but no job of a workflow that runs on pull_request has that name, so a pull request waits for it forever (docs/tooling/ci.md ("ci.yml の job")).`;

  it("どの job も報告しない必須チェックを拒否すること", () => {
    const renamed = "on: pull_request\njobs:\n  lint:\n    steps: []\n";
    expect(violations(repo({ [workflow]: renamed }))).toEqual([waits("commitlint")]);
  });

  it.each([
    ["only on push", "on:\n  push:\n"],
    ["on pull_request_target", "on: pull_request_target\n"],
    ["on a list without pull_request", "on: [push, workflow_dispatch]\n"],
    ["without on", ""],
  ])("%s で動く workflow の job を拒否すること", (_, on) => {
    expect(violations(repo({ [workflow]: on + job }))).toEqual([waits("commitlint")]);
  });

  it.each([
    ["a string", "on: pull_request\n"],
    ["a list", "on: [push, pull_request]\n"],
    ["a map", "on:\n  pull_request:\n    types: [opened]\n"],
  ])("%s と書いた on を読むこと", (_, on) => {
    expect(violations(repo({ [workflow]: on + job }))).toEqual([]);
  });

  it("job に名前があれば、GitHub がチェックに付けるとおり、その名前に一致すること", () => {
    const named = (name: string) =>
      `on: pull_request\njobs:\n  lint:\n    name: ${name}\n    steps: []\n`;
    expect(violations(repo({ [workflow]: named("commitlint") }))).toEqual([]);
    const idOnly = "on: pull_request\njobs:\n  commitlint:\n    name: Commit lint\n    steps: []\n";
    expect(violations(repo({ [workflow]: idOnly }))).toEqual([waits("commitlint")]);
  });

  it("required_status_checks の規則のチェックだけを読むこと", () => {
    const other = JSON.stringify({
      rules: [{ type: "pull_request", parameters: { required_status_checks: [{ context: "x" }] } }],
    });
    expect(violations(repo({ ".github/rulesets/protect-main.json": other }))).toEqual([]);
  });

  it(".github/workflows のすべての workflow を読み、ほかの場所のファイルを読まないこと", () => {
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

describe("ci.yml が実行するすべての Nx の target が、docs/tooling/commands.md にコマンドを持つこと", () => {
  const violations = failuresOf(ciTargetsHaveCommands);
  const ci = base[".github/workflows/ci.yml"] ?? "";
  const runs = (command: string) =>
    ci.replace("run: tools/scripts/sh/guard-push.sh", `run: ${command}`);
  const commands = (...rows: string[]) =>
    ["# 開発コマンド", "", "| やりたいこと | コマンド |", "| --- | --- |", ...rows, ""].join("\n");
  const missing = (target: string) =>
    `.github/workflows/ci.yml runs the Nx target ${target}, but docs/tooling/commands.md has no nx command that runs it. Add the command a person runs to its table (docs/tooling/ci.md ("検査を足すとき")).`;

  it("commands.md が実行しない nx affected の target を拒否すること", () => {
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
  ])("commands.md が %s で実行する target を通すこと", (_, cell) => {
    expect(
      violations(
        repo({
          ".github/workflows/ci.yml": runs("pnpm exec nx affected -t check db-types-check"),
          "docs/tooling/commands.md": commands(`| 検査 | ${cell} |`),
        }),
      ),
    ).toEqual([]);
  });

  it("ほかの flag の後、= または空白をつけた --targets の後、すべての nx コマンドの target を読むこと", () => {
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

  it("フェンスのコードブロックの後のインラインコードを読むこと", () => {
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

  it("target を実行しない nx コマンドから target を見つけないこと", () => {
    const step =
      "pnpm exec nx show projects --affected && pnpm exec nx affected --graph && echo onx affected -t x";
    expect(
      violations(
        repo({ ".github/workflows/ci.yml": runs(step), "docs/tooling/commands.md": commands() }),
      ),
    ).toEqual([]);
  });

  it("nx コマンドの外で commands.md が挙げる target を数えないこと", () => {
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
