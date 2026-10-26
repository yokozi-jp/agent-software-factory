---
type: Reference
title: CI
description: GitHub Actions の各 workflow が実行するタイミングと内容、ci.yml に含まれる追加の検証。CI が失敗したとき、workflow を変えるときに読む。
tags: [tooling, reference, ci, github-actions]
---

# CI

workflow は `.github/workflows/` にあり、全ての Action は commit SHA で固定し、更新は Renovate の PR で行います ([Renovate](renovate.md))。
必須チェックにする job が対象外の PR で pending にならないよう、検証は path で絞らずに実行します。

## workflow

| workflow                | 実行タイミング     | 内容                                                                                                                                                                                       |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ci.yml`                | PR、main への push | 下の検証と `nx affected -t check test build mutation` (3 つの job を並列に実行し、`main` でまとめる)                                                                                       |
| `commitlint.yml`        | PR                 | PR タイトルと PR 内の全コミットを検証                                                                                                                                                      |
| `secret-scan.yml`       | PR、main への push | PR は PR のコミットを、main は全履歴を betterleaks で scan                                                                                                                                 |
| `dependency-review.yml` | PR                 | PR が足した依存に、重大度 high 以上の既知の脆弱性があれば失敗する (`actions/dependency-review-action`、runtime と development の両方。[ADR 0021](../adr/0021-sast-and-dependency-scan.md)) |
| `release.yml`           | 手動               | `nx release` ([リリース](../repository/release.md))                                                                                                                                        |

CodeQL は workflow のファイルを持たない default setup で、GitHub が PR と main を解析します。merge を止めるのは ruleset の `code_scanning` の規則です ([GitHub リポジトリの設定](../repository/github-settings.md))。

## ci.yml の job

`ci.yml` は 4 つの job で、`checks`、`scripts`、`nx` を並列に実行し、最後に `main` が結果をまとめます。`main` 以外は `setup-vp` で依存を入れます。

| job       | 内容                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks`  | mise の道具を使わない検査: repo policy、Renovate の設定、skills-lock、adr-check、Markdown、docs、root、jscpd、Knip                                                                                                |
| `scripts` | mise で入れた道具を使う検査とスクリプトのテスト: shellcheck、jactionlint と zizmor、Semgrep、OSV-Scanner、`nx affected -t test-tools`、Script tests。sh のテストを 1 つずつ順に実行するので、いちばん時間がかかる |
| `nx`      | `nx affected -t check test build mutation` (`tools/scripts` を含む) と、build の後に生成ファイルが commit 済みであること                                                                                          |
| `main`    | `checks`、`scripts`、`nx` のどれかが成功しなかったら失敗する。ruleset の必須チェック (`protect-main`) はこの名前を指す                                                                                            |

`main` は、必須チェックの名前を `main` のまま残すための job です。job を足すときは、`main` の `needs` にも足します。足さないと、その job が失敗しても merge できます。
`main` の `if: always()` は、`needs` の job が失敗したときも `main` を実行して失敗させるために要ります。`always()` がないと、`needs` の job が失敗または skip されたとき `main` も skip されます ([GitHub Docs の workflow syntax の `jobs.<job_id>.needs`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax))。必須チェックでは skip が成功として扱われます ([GitHub Docs の About status checks](https://docs.github.com/articles/about-status-checks))。

## ci.yml の検証

どれも、対応するファイルを変えたときに pre-commit hook でも実行します (adr-check は pre-push hook で実行し、そのテストは `tools/scripts` を変えた commit の pre-commit hook で `nx test scripts` として実行します)。

- `scripts/check-repo-policy.sh`: ADR の決定を機械的に確認します (`@nx/vite` がない、`vite.config.ts` に `run` がない、`.vite-hooks` がない、betterleaks のバージョンが一致している、ADR の番号が重複していない、Node.js のメジャー版が `.node-version`・`engines.node`・`@types/node` の catalog・`vite.config.ts` の build target でそろっている、`ci.yml` の `main` 以外の全ての job が `main` の `needs` に入っている)。CI は作業ツリーを、pre-commit は `staged` を付けてステージした内容を検査します。ステージしていない他のファイルの編集で、コミットが止まらないようにするためです。
  `docs/` の外 (スクリプト、設定、`AGENTS.md`、workflow) に書いた `docs/...md` のパス、`docs/...md ("見出し")` の見出し、`docs/adr/NNNN` の番号が実在することも確認します。見出しは番号を付けずに書きます。
  `ci.yml` の `main` が必須チェックをまとめる job のとき、`needs` に入っていない job は、失敗しても merge を止めません。そこで `needs` は 1 行の `needs: [a, b]` の形で書き、`main` 以外の job が全て入っていることを確認します。
  `git init`、`git clone`、`git -C`、`--git-dir`、`GIT_DIR=` で別のリポジトリを操作するスクリプトは、`scripts/test/lib.sh` を読み込んだテストの中だけに置けます (理由は「スクリプトのテスト」)。`tools/scripts/src` の TypeScript は対象外です。文字の並びでは `execFileSync("git", ["-C", …])` を見つけられないので、lint の規則と `isolation.test.ts` が守ります ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md))。
  `scripts/test/*.test.sh` がどれも workflow と `lefthook.yml` の両方で実行されること (コメントの中の名前は数えません)、git で管理しているシェルスクリプトの mode が `100755` であることも確認します。
- `scripts/test/run.sh`: sh のスクリプトの動作をテストします ([スクリプトのテスト](#スクリプトのテスト))。
- `tools/scripts` の Nx の target: `test` (`nx` の job) は TypeScript の検査と hook のテスト、`mutation` (`nx` の job) はその純粋な関数への Stryker、`test-tools` (`scripts` の job) は本物の道具と設定を使うテストです ([スクリプトのテスト](#スクリプトのテスト))。
- `node tools/scripts/src/checks/adr-check/cli.ts` (adr-check): 依存、ツールの設定、workflow、ruleset、Kiro の hook や設定 (対象は `tools/scripts/src/checks/adr-check/rules.ts` の `isDecisionPath`) を変えたのに、PR の base との差分に ADR (`docs/adr/NNNN-*.md`) の追加がないと、`::warning::` を出します。job は失敗させません ([ADR 0016](../adr/0016-adr-check-warns-without-blocking.md))。テストと fixture の変更は対象外です。base と比べられない (浅い clone など) ときは、理由を `::notice::` に出して通します。pre-push hook でも実行します ([Git hook](git-hooks.md))。
- `scripts/shellcheck.sh`: git で管理しているシェルスクリプト (`.agents/` を除く) を shellcheck で検査します。版は `mise.toml` と `mise.lock` で固定し、CI は `jdx/mise-action` で lock のとおりに入れます ([ADR 0008](../adr/0008-pin-shellcheck.md)、[ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。
- `scripts/lint-workflows.sh`: git で管理している `.github/workflows/` の workflow を jactionlint (actionlint の fork。`.github/jactionlint.yaml` の `correctness` profile) と zizmor で検査します ([ADR 0012](../adr/0012-lint-workflows.md))。jactionlint は構文、式の型、参照の誤りを、zizmor は script injection、過大な権限、`persist-credentials` の書き忘れなどを見つけます。jactionlint は `run:` のスクリプトも固定した shellcheck で検査します。
  zizmor は `--offline` で動かすので、GitHub API を使う audit は実行しません ([zizmor の Usage](https://docs.zizmor.sh/usage/))。版は shellcheck と同じく mise で固定します。指摘を抑制するときは、その場所に理由を書きます (`# zizmor: ignore[<audit>]`、`# shellcheck disable=SCxxxx`)。
- `scripts/semgrep.sh`: Semgrep CE の SAST で、PR の base (`origin/$GITHUB_BASE_REF`、なければ `origin/main`) との merge base になかった ERROR の指摘だけで失敗します ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))。規則は Semgrep Registry の `p/typescript` と `p/react` で、実行のたびに取り寄せるのでネットワークが要ります。base にすでにある指摘と、ERROR より軽い指摘は、CodeQL の code scanning の alert で扱います。
  終了コードは、新しい指摘が 1、検査できなかった (mise がない、base がない、Semgrep の失敗) ときが 2 以上で、CI はどちらも失敗にします。指摘を抑えるときは、その行に `nosemgrep: <rule-id>` と理由を書きます。
  Semgrep は PyPI にしかないので、mise の `pypi` backend が uv で入れます。依存のグラフ (wheel の hash) は `.mise/locks/pypi-semgrep/<版>/uv.lock` にあり、`mise.lock` がその digest を記録します。`mise lock` を実行したら `.mise/locks/` も commit します。
- `scripts/osv-scanner.sh`: OSV-Scanner で `pnpm-lock.yaml` の既知の脆弱性を一覧にし、見つけたら `::warning::` を出します。job は失敗させません ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))。依存のゲートは `dependency-review.yml` です。osv.dev に問い合わせるので、ネットワークが要ります。問い合わせに失敗したら、そう警告して通します。脆弱性を無視するときは、`osv-scanner.toml` の `[[IgnoredVulns]]` に理由を書きます。
- `node tools/scripts/src/checks/skills-lock/cli.ts` (skills-lock): `.agents/skills` が `skills-lock.json` の記録と一致し、`.kiro/skills` に各 skill への symlink があることを確認します。skill は upstream からインストールしたものなので、手で編集しません。
- `pnpm lint:md`: 全ての Markdown を markdownlint-cli2 で検査します。
- `node tools/scripts/src/checks/docs-check/cli.ts` (docs-check): `docs/` を OKF v0.2 バンドルとして検査します ([docs の書き方](../knowledge/documentation-authoring.md))。引用符のない frontmatter の値に、コロンと空白、または空白と `#` が続く部分があると、YAML が壊れて iwe が必須項目の欠落と誤って報告するので、その原因を先に示します。文書へのリンクが `.md` で終わることも見ます (GitHub は拡張子のないリンクをたどれません)。CI は `staged` を付けずに実行するので、`about.md` の記録の検査は pre-commit だけで行います。
- `scripts/renovate.sh validate`: `renovate.jsonc` を、`scripts/renovate.sh` に固定した版の Renovate の `renovate-config-validator --strict` で検査します ([Renovate](renovate.md))。`pnpm dlx` で Renovate を取るので、ネットワークが要ります。
- `pnpm check:root` (`scripts/check-root-files.sh`): `apps/`、`packages/`、`tools/` の外にあるファイル (ルートの設定ファイル、`scripts/`、`docs/`、`.github/` など) に `vp check` を実行します。
  各プロジェクトの `check` は Nx のプロジェクトの中のファイルしか見ないので、これらのファイルはこのステップで検査します。
  対象は `git ls-files` で選ぶので、commit していない作業用のファイルは検査しません。
  pre-commit hook では、ステージしたファイルに `vp check --fix` を実行します。
- `pnpm lint:dup` (jscpd): `apps/` と `packages/` の JavaScript、TypeScript、CSS の重複を検査し、重複率が `.jscpd.json` の `threshold` を超えると失敗します ([ADR 0014](../adr/0014-jscpd-duplication-threshold.md))。
  `.gitignore` の対象 (`dist`、`.tanstack/` など)、生成物 (`routeTree.gen.ts`)、テストの fixture は対象外です。閾値の値と、それを決めた理由は ADR 0014 に書きます。clone はファイルをまたぐので、pre-commit hook でもステージした内容ではなく作業ツリー全体を検査します。意図した重複は `// jscpd:ignore-start` と `// jscpd:ignore-end` で囲み、理由を書きます。
- `pnpm lint:unused` (Knip): pnpm workspace の全てのプロジェクトとルートで、どこからも使われていないファイル、export、依存を見つけると失敗します ([ADR 0017](../adr/0017-knip-unused-code.md))。設定は `knip.jsonc` です。
  Knip が読めない場所 (シェルスクリプト、Kiro の設定など) からだけ使うファイルや依存は、`knip.jsonc` に例外として個別に書き、理由をそのそばに書きます。意図して残す export には `/** @public */` と理由を書きます。不要になった例外も失敗します (`treatConfigHintsAsErrors`)。
  未使用かどうかはほかのファイルの import で決まるので、pre-commit hook でもステージした内容ではなく作業ツリー全体を検査します。
- build の後に `git status` が空であること: `routeTree.gen.ts` などの生成ファイルを commit し忘れると失敗します。

## 検査を足すとき

検査はローカルと CI で同じコマンドを呼ぶので、1 つ足すと次の場所を全部直します。`pnpm lint:dup` (jscpd) を足した PR #91 が例です。

1. コマンド: リポジトリ全体を見る検査は、`tools/scripts/src/checks/<name>/` の TypeScript (`node tools/scripts/src/checks/<name>/cli.ts` で実行) か、ルートの `package.json` の script にします。1 つの CLI に引数を渡すだけなら sh でも構いません ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md))。プロジェクトごとの検査は、そのプロジェクトの `package.json` の script にし、Nx の target として動かします。どちらも `vp run` は使いません ([ADR 0002](../adr/0002-nx-orchestrates-vite-plus.md))。道具の版は、npm で配られるものは `pnpm-workspace.yaml` の catalog で、それ以外は `mise.toml` で固定します ([ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。
2. `ci.yml` の job に step を足します。mise の道具を使う検査とスクリプトのテストは `scripts` に、それ以外でリポジトリ全体を見る検査は `checks` に、プロジェクトごとの検査は `nx` に入れます。新しい job を作るなら `main` の `needs` に足します。
3. `lefthook.yml` の `pre-commit` に job を足します。`glob` には、検査の対象のファイルと、道具の版を固定するファイル (`pnpm-workspace.yaml` か `mise.toml` と `mise.lock`) を入れます。
4. 止めるべき入力で失敗し、通すべき入力で通ることを確かめます。TypeScript の検査は `tools/scripts` の Vitest のテスト (下の「スクリプトのテスト」) にし、一覧に載せる必要はありません。sh の検査は `scripts/test/<name>.test.sh` にし、`ci.yml` の Script tests と `lefthook.yml` の job に載せます。載せ忘れと実行権限の付け忘れは `check-repo-policy.sh` が止めます。
5. docs: この文書の「ci.yml の検証」、[開発コマンド](commands.md) の構成とコマンドの表、[Git hook](git-hooks.md) の `pre-commit` の行。
6. 道具や設定を選んだ理由は ADR に書きます。番号は `scripts/check-adr-number.sh` で決めます ([並行作業と worktree](worktrees.md#pr-を出す))。

## スクリプトのテスト

スクリプトと hook のテストには、`tools/scripts` の TypeScript のテストと、まだ移していない sh のテストの 2 つがあります。どちらも、止めるべき入力で止まり、通すべき入力を通すかを確かめます。sh から TypeScript への移行は [Issue #158](https://github.com/yokozi-jp/agent-software-factory/issues/158) の手順で進めます ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md))。

### tools/scripts のテスト

`tools/scripts` は Nx の project (`scripts`) で、テストは Vitest です。

| target       | 実行するもの                                                                                                           | 走る場所                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`       | `unit` と `isolation` の Vitest の project。coverage の下限 (ファイルごとに lines と branches が 90%) とラチェットつき | CI の `nx` の job (`nx affected`)、`tools/scripts/**`、`.kiro/hooks/*.json`、Nx の `sharedGlobals` のどれかのファイルを変えた commit の pre-commit (`nx test scripts`) |
| `mutation`   | `src/` の純粋な関数への Stryker (`--incremental`、`stryker.config.mjs`)。score が `break` (100) を下回ると失敗         | CI の `nx` の job (`nx affected`)                                                                                                                                      |
| `test-tools` | `tools` の Vitest の project (`*.tools.test.ts`): 本物の道具と設定を使うテスト。今は docs-check (iwe)                  | CI の `scripts` の job (`nx affected -t test-tools`)                                                                                                                   |

- 規則は純粋な関数 (`src/checks/<名前>/rules.ts`) にし、その場で呼ぶテスト (`rules.test.ts`) で確かめます。入口 (`cli.ts`) は、argv、標準入力、環境変数、git を読んで出力するだけにし、少数のプロセスのテスト (`cli.test.ts`) で、sandbox の中の git を使って確かめます。入口は子プロセスで動き coverage が見えないので、coverage と Stryker の対象から外しています。
- Kiro の hook も同じ形です。検査ごとの規則は `src/hooks/<検査>.ts`、入口は trigger ごとに `src/hooks/pre-tool-use/cli.ts` と `src/hooks/session-start/cli.ts` です。入口のプロセスのテストは、Kiro が送る形の event の JSON を標準入力に入れ、exit コード (0 か 2)、stderr、stdout を確かめます。
- テストは宣言していない入力を読みません。`test` のテストは project の中のファイル (fixture) だけを読みます。例外の `.kiro/hooks/*.json` (`src/hooks/kiro-hooks.test.ts` が入口のパスと `matcher` を確かめる) は、`test` の `inputs` に書いてあります。本物の道具と設定を使うテストは `*.tools.test.ts` にし、読む設定ファイルを `tools/scripts/package.json` の `test-tools` の `inputs` に `{workspaceRoot}/…` でファイルごとに書きます。書かないと、その設定を変えても `nx affected` がテストを走らせず、cache が古い結果を返します。
- アプリだけを変えた PR では、`tools/scripts` のテストは走りません。

git を使うテストは、このリポジトリを触らないように次の規則を守ります。

- 一時的なリポジトリは `sandbox()` (`src/test/sandbox.ts`) の中に作ります。git は `gitIn(dir, args)` で、ほかのコマンドは `runIn(dir, command, args)` で起動します。どちらも `dir` が sandbox の外なら例外にし、`HOME` を sandbox にします。
- テストのファイルは `node:child_process` を import できません (ルートの `vite.config.ts` の `no-restricted-imports`)。この規則が効いていることは、`src/test/fixtures/child-process.test.ts` の `oxlint-disable-next-line` が確かめます。規則が外れると、使われない disable のコメントで `vp check` が失敗します。
- Vitest の `setupFiles` (`src/test/setup.ts`) が、git が hook の中で設定する `GIT_DIR`、`GIT_INDEX_FILE` など (`git rev-parse --local-env-vars`) を消し、ユーザーとシステムの git の設定を読まないようにし、`GIT_ALLOW_PROTOCOL=file` でネットワーク越しの git を禁じます。
- `src/test/isolation.test.ts` は、decoy のリポジトリを指す hook の変数を設定し、decoy を作業ディレクトリにして `unit` のテストを子プロセスで動かし、decoy が変わらないことを確かめます。`gitIn` を通さずに作業ディレクトリのリポジトリや hook の変数が指すリポジトリを変えるテストを足すと、このテストが失敗します。fingerprint を取るのは decoy だけなので、動的な `import()` で `node:child_process` を読み込み、`git -C <このリポジトリの絶対パス>` のように別のリポジトリをパスで指定するテストは見つかりません。この場合は、静的な import を止める `no-restricted-imports` と、レビューで守ります ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md) の「隔離」)。

### sh のテスト

`scripts/test/*.test.sh` は、`scripts/` のスクリプトをテストします。
`ci.yml` で実行し、`secret-scan.test.sh` は mise で betterleaks を入れた `secret-scan.yml` で実行します。pre-commit hook でも、対象のスクリプトを変えたときに実行します。

テストは一時ディレクトリに git リポジトリを作って操作するので、このリポジトリを触らないように次の規則を守ります。

- テストは `scripts/test/lib.sh` を読み込み、`make_sandbox` で作った `$sandbox` の中だけで git を使います。
- git の操作は `in_sandbox_repo <dir> <command>` を通します。`<dir>` のリポジトリが `$sandbox` の外にあると、実行せずに止まります。
- push と fetch の宛先は、`origin` などの名前ではなく、`$sandbox` の中のパスにします。

`lib.sh` は、git が hook の中で設定する `GIT_DIR`、`GIT_INDEX_FILE` などを消し、`GIT_CEILING_DIRECTORIES` でリポジトリの探索を `$sandbox` で止め、`GIT_ALLOW_PROTOCOL=file` でネットワーク越しの git を禁じます。
これらがないと、pre-commit hook から実行したテストが、このリポジトリに commit して main に push します (2026-10-23 に実際に起きました。[PR #10](https://github.com/yokozi-jp/agent-software-factory/pull/10))。
`isolation.test.sh` は hook と同じ変数を設定して他のテストを実行し、その変数が指すリポジトリが変わらないことを確かめます。
テストが失敗すると、失敗したコマンドの出力の最後の20行を表示します。
