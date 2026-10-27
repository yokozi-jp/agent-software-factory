---
type: Reference
title: CI
description: GitHub Actions の各 workflow が実行するタイミングと内容、ci.yml に含まれる追加の検証。CI が失敗したとき、workflow を変えるときに読む。
tags: [tooling, reference, ci, github-actions]
---

# CI

workflow は `.github/workflows/` にあり、全ての Action は commit SHA で固定し、更新は Renovate の PR で行います ([Renovate](renovate.md))。
必須チェックにする job が対象外の PR で pending にならないよう、検証は path で絞らずに実行します。
どの検証が何を保証し、どのゲートが強制し、検出力をどう確かめるかは [保証カタログ](assurance-catalog.md) を正とします。この文書には、実行のしかたと、止まったときの扱いを書きます。

## workflow

| workflow                | 実行タイミング     | 内容                                                                                                                                                                                       |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ci.yml`                | PR、main への push | 下の検証と `nx affected -t check test build` と `nx affected -t lint-effect` (3 つの job を並列に実行し、`main` でまとめる)                                                                |
| `commitlint.yml`        | PR                 | PR タイトルと PR 内の全コミットを検証                                                                                                                                                      |
| `secret-scan.yml`       | PR、main への push | secret-scan の `*.tools.test.ts` (本物の betterleaks のテスト) とその隔離の後、PR は PR のコミットを、main は全履歴を betterleaks で scan                                                  |
| `dependency-review.yml` | PR                 | PR が足した依存に、重大度 high 以上の既知の脆弱性があれば失敗する (`actions/dependency-review-action`、runtime と development の両方。[ADR 0021](../adr/0021-sast-and-dependency-scan.md)) |
| `issue-tracker.yml`     | 毎週月曜、手動     | open な Issue の消えたパス、地図の実施の Issue の漏れ、`Blocked by:` の張り忘れた辺を報告する。必須チェックではない ([Issue tracker](../agents/issue-tracker.md#検査))                     |
| `release.yml`           | 手動               | `nx release` ([リリース](../repository/release.md))                                                                                                                                        |

CodeQL は workflow のファイルを持たない default setup で、GitHub が PR と main を解析します。merge を止めるのは ruleset の `code_scanning` の規則です ([GitHub リポジトリの設定](../repository/github-settings.md))。

## ci.yml の job

`ci.yml` は 4 つの job で、`checks`、`scripts`、`nx` を並列に実行し、最後に `main` が結果をまとめます。`main` 以外は `setup-vp` で依存を入れます。

| job       | 内容                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks`  | mise の道具を使わない検査: repo policy、Renovate の設定、skills-lock、adr-check、test-weakening、Markdown、docs、root、jscpd、Knip                                           |
| `scripts` | mise で入れた道具を使う検査と、道具を動かすテスト: shellcheck、jactionlint と zizmor、Semgrep、OSV-Scanner、`nx affected -t test-tools`                                      |
| `nx`      | `nx affected -t check test build` (`tools/scripts` を含む)、`nx affected -t lint-effect` ([Effect の検査](effect-lint.md))、build の後に生成ファイルが commit 済みであること |
| `main`    | `checks`、`scripts`、`nx` のどれかが成功しなかったら失敗する。ruleset の必須チェック (`protect-main`) はこの名前を指す                                                       |

`main` は、必須チェックの名前を `main` のまま残すための job です。job を足すときは、`main` の `needs` にも足します。足さないと、その job が失敗しても merge できます。
`main` の `if: always()` は、`needs` の job が失敗したときも `main` を実行して失敗させるために要ります。`always()` がないと、`needs` の job が失敗または skip されたとき `main` も skip されます ([GitHub Docs の workflow syntax の `jobs.<job_id>.needs`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax))。必須チェックでは skip が成功として扱われます ([GitHub Docs の About status checks](https://docs.github.com/articles/about-status-checks))。

## ci.yml の検証

どれも、対応するファイルを変えたときに pre-commit hook でも実行します (pre-push hook は、`nx affected -t test` も実行し、影響を受ける project の coverage の下限を push の前に確かめます。adr-check と test-weakening は pre-push hook で実行し、そのテストは `tools/scripts` を変えた commit の pre-commit hook で `nx test scripts` として実行します)。どの hook の job がどの検証の写しかは、[保証カタログ](assurance-catalog.md) の「ローカルの写し」の列にあります。

- `node tools/scripts/src/checks/repo-policy/cli.ts` (repo-policy): ADR の決定を機械的に確認します (`@nx/vite` がない、`vite.config.ts` に `run` がない、`.vite-hooks` がない、betterleaks のバージョンが一致している、ADR の番号が重複していない、Node.js のメジャー版が `.node-version`・`engines.node`・`@types/node` の catalog・`vite.config.ts` の build target でそろっている、`ci.yml` の `main` 以外の全ての job が `main` の `needs` に入っている)。CI は作業ツリーを、pre-commit は `staged` を付けてステージした内容を検査します。ステージしていない他のファイルの編集で、コミットが止まらないようにするためです。
  `docs/` の外 (スクリプト、設定、`AGENTS.md`、workflow) に書いた `docs/...md` のパス、`docs/...md ("見出し")` の見出し、`docs/adr/NNNN` の番号が実在することも確認します。見出しは番号を付けずに書きます。
  `ci.yml` の `main` が必須チェックをまとめる job のとき、`needs` に入っていない job は、失敗しても merge を止めません。そこで、`main` 以外の job が全て `needs` に入っていることを確認します。`needs` は 1 つの job の id でも、job の id のリストでも書けます ([GitHub Docs の workflow syntax の `jobs.<job_id>.needs`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax))。リストは 1 行の配列でも、複数行のリストでも読みます。`ci.yml` がなければ失敗します。
  `tools/scripts/sh/*.sh` が、`git init`、`git clone`、`git -C`、`--git-dir`、`GIT_DIR=` で別のリポジトリを操作していないことも確認します。Git hook の中で動くと、hook を動かしたリポジトリに効くためです (理由は「スクリプトのテスト」)。別のリポジトリが要るテストは TypeScript で `gitIn` を通して書きます。TypeScript は対象外です。文字の並びでは `execFileSync("git", ["-C", …])` を見つけられないので、lint の規則と `isolation.test.ts` が守ります ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md))。
  `tools/scripts/sh/*.sh` の mode が `100755` であることも確認します。
  `packages/` の `shared` 以外の package が、ルートの `vite.config.ts` の `modules` にあること (ないと、その package の import を止める規則がありません)、各 package の `src/` と各モジュールの各層 (`vite.config.ts` の `layers`) の `__fixtures__/` に、`oxlint-disable-next-line no-restricted-imports` を書いた fixture があることも確認します ([ADR 0026](../adr/0026-modules-as-packages-with-oxlint-boundaries.md))。`vite.config.ts` の `layers` に `domain` があれば、各モジュールの `src/domain/__fixtures__/` に、`domain/no-throw`、`no-restricted-globals`、`no-restricted-properties` の disable のコメントを書いた fixture があることも確認します ([ADR 0027](../adr/0027-domain-model-as-pure-functions-and-unions.md))。
  `tools/scripts/package.json` の `test-tools` の `inputs` のうち `{workspaceRoot}/…` のものが、`lefthook.yml` の `scripts-test-tools` の `glob` に同じ文字列で入っていることも確認します。Nx と lefthook では glob の書き方が違うので、パターンの照合はしません。意図して外すものは、repo-policy の `rules.ts` の `notInHook` に理由を添えて書きます。
  [保証カタログ](assurance-catalog.md) の表と、`ci.yml` の step、ruleset の規則、`lefthook.yml` の job、`.kiro/hooks/` の hook と `tools/scripts/src/hooks/` の検査が対応していること (行のない名前、設定にない名前、2 回出る名前、「検出力の確かめ方」が空の行がない) と、ruleset の必須チェックがどれも `pull_request` で動く workflow の job の名前であることも確認します。照合の決まりはカタログの「表と設定のずれの検査」にあります。
  設定ファイル (workflow、`pnpm-workspace.yaml`、`mise.toml`、`.betterleaks.toml`、`package.json`、steering の frontmatter) は、catalog で固定したパーサー (`yaml`、`smol-toml`) と `JSON.parse` で読みます。値を取り出す検査は、引用符、コメント、1 行か複数行かで結果が変わりません。例外は steering の `fileMatchPattern` で、1 行の配列 (`["a", "b"]`) で書くことを求めます。読めないファイルは、パーサーのエラーを添えて失敗します。`vite.config.ts` は文字列として読みます。
- `tools/scripts` の Nx の target: `test` (`nx` の job) は TypeScript の検査と hook のテスト、`mutation` (1日1回の `mutation.yml`。[ADR 0031](../adr/0031-mutation-testing-outside-pull-requests.md)) はその純粋な関数への Stryker、`test-tools` (`scripts` の job) は本物の道具と設定を使うテストです ([スクリプトのテスト](#スクリプトのテスト))。
- `node tools/scripts/src/checks/adr-check/cli.ts` (adr-check): 依存、ツールの設定、workflow、ruleset、Kiro の hook や設定 (対象は `tools/scripts/src/checks/adr-check/rules.ts` の `isDecisionPath`) を変えたのに、PR の base との差分に ADR (`docs/adr/NNNN-*.md`) の追加がないと、`::warning::` を出します。job は失敗させません ([ADR 0016](../adr/0016-adr-check-warns-without-blocking.md))。テストと fixture の変更は対象外です。base と比べられない (浅い clone など) ときは、理由を `::notice::` に出して通します。pre-push hook でも実行します ([Git hook](git-hooks.md))。
- `node tools/scripts/src/checks/test-weakening/cli.ts` (test-weakening): PR の base との merge base から、テストファイル (`*.test.*`、`*.spec.*`。`fixtures/` は除く) を消したか、1 つのテストファイルの中のテストケースの数が減ったら、`::warning title=test-weakening::` を出します。job は失敗させません (adr-check と同じ理由。[ADR 0016](../adr/0016-adr-check-warns-without-blocking.md))。名前を変えたファイルは元のファイルと比べ、テストファイルではない名前への変更は削除として扱います。
  テストケースの数は、ファイルの文字から `it(` と `test(` (`.each`、`.for`、`.concurrent` などを付けたものを含む) を数えた推定です。コメントの中は数えず、`.skip` と `.todo` は数えません。表 (`it.each(table)`) は 1 つと数えます。文字列の中の `it(` も数えるので、同じファイルの変更の前と後だけを比べます。
  警告の出た PR は、人がマージの前に必ず読みます ([coding agent が書いたプルリクエストのレビュー](../code-review/agent-pull-requests.md#人が判断するもの))。auto-merge の対象から外す条件 ([Issue #35](https://github.com/yokozi-jp/agent-software-factory/issues/35)) は、この annotation の title で見分けられます。意図した変更は、pre-push では `TESTS_ACK=1` で抑えます。base と比べられないときは、adr-check と同じく理由を `::notice::` に出して通します。
- `tools/scripts/sh/shellcheck.sh`: git で管理しているシェルスクリプト (`.agents/` を除く) を shellcheck で検査します。版は `mise.toml` と `mise.lock` で固定し、CI は `jdx/mise-action` で lock のとおりに入れます ([ADR 0008](../adr/0008-pin-shellcheck.md)、[ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。
- `tools/scripts/sh/lint-workflows.sh`: git で管理している `.github/workflows/` の workflow を jactionlint (actionlint の fork。`.github/jactionlint.yaml` の `correctness` profile) と zizmor で検査します ([ADR 0012](../adr/0012-lint-workflows.md))。jactionlint は構文、式の型、参照の誤りを、zizmor は script injection、過大な権限、`persist-credentials` の書き忘れなどを見つけます。jactionlint は `run:` のスクリプトも固定した shellcheck で検査します。
  zizmor は `--offline` で動かすので、GitHub API を使う audit は実行しません ([zizmor の Usage](https://docs.zizmor.sh/usage/))。版は shellcheck と同じく mise で固定します。指摘を抑制するときは、その場所に理由を書きます (`# zizmor: ignore[<audit>]`、`# shellcheck disable=SCxxxx`)。
- `node tools/scripts/src/checks/semgrep/cli.ts` (Semgrep): Semgrep CE の SAST で、PR の base (`origin/$GITHUB_BASE_REF`、なければ `origin/main`) との merge base になかった ERROR の指摘だけで失敗します ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))。規則は Semgrep Registry の `p/typescript` と `p/react` で、実行のたびに取り寄せるのでネットワークが要ります。base にすでにある指摘と、ERROR より軽い指摘は、CodeQL の code scanning の alert で扱います。
  終了コードは、新しい指摘が 1、検査できなかった (mise がない、base がない、Semgrep の失敗) ときが 2 以上で、CI はどちらも失敗にします。指摘を抑えるときは、その行に `nosemgrep: <rule-id>` と理由を書きます。
  Semgrep は PyPI にしかないので、mise の `pypi` backend が uv で入れます。依存のグラフ (wheel の hash) は `.mise/locks/pypi-semgrep/<版>/uv.lock` にあり、`mise.lock` がその digest を記録します。`mise lock` を実行したら `.mise/locks/` も commit します。
- `tools/scripts/sh/osv-scanner.sh`: OSV-Scanner で `pnpm-lock.yaml` の既知の脆弱性を一覧にし、見つけたら `::warning::` を出します。job は失敗させません ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))。依存のゲートは `dependency-review.yml` です。osv.dev に問い合わせるので、ネットワークが要ります。問い合わせに失敗したら、そう警告して通します。脆弱性を無視するときは、`osv-scanner.toml` の `[[IgnoredVulns]]` に理由を書きます。
- `node tools/scripts/src/checks/skills-lock/cli.ts` (skills-lock): `.agents/skills` が `skills-lock.json` の記録と一致し、`.kiro/skills` に各 skill への symlink があることを確認します。skill は upstream からインストールしたものなので、手で編集しません。
- `pnpm lint:md`: 全ての Markdown を markdownlint-cli2 で検査します。
- `node tools/scripts/src/checks/docs-check/cli.ts` (docs-check): `docs/` を OKF v0.2 バンドルとして検査します ([docs の書き方](../knowledge/documentation-authoring.md))。引用符のない frontmatter の値に、コロンと空白、または空白と `#` が続く部分があると、YAML が壊れて iwe が必須項目の欠落と誤って報告するので、その原因を先に示します。文書へのリンクが `.md` で終わることも見ます (GitHub は拡張子のないリンクをたどれません)。CI は `staged` を付けずに実行するので、`about.md` の記録の検査は pre-commit だけで行います。
- `tools/scripts/sh/renovate.sh validate`: `renovate.jsonc` を、`tools/scripts/sh/renovate.sh` に固定した版の Renovate の `renovate-config-validator --strict` で検査します ([Renovate](renovate.md))。`pnpm dlx` で Renovate を取るので、ネットワークが要ります。
- `pnpm check:root` (`tools/scripts/sh/check-root-files.sh`): `apps/`、`packages/`、`tools/` の外にあるファイル (ルートの設定ファイル、`docs/`、`.github/` など) に `vp check` を実行します。
  各プロジェクトの `check` は Nx のプロジェクトの中のファイルしか見ないので、これらのファイルはこのステップで検査します。
  対象は `git ls-files` で選ぶので、commit していない作業用のファイルは検査しません。
  pre-commit hook では、ステージしたファイルに `vp check --fix` を実行します。
- `pnpm lint:dup` (jscpd): `apps/` と `packages/` の JavaScript、TypeScript、CSS の重複を検査し、重複率が `.jscpd.json` の `threshold` を超えると失敗します ([ADR 0014](../adr/0014-jscpd-duplication-threshold.md))。
  `.gitignore` の対象 (`dist`、`.tanstack/` など)、生成物 (`routeTree.gen.ts`)、テストの fixture は対象外です。閾値の値と、それを決めた理由は ADR 0014 に書きます。clone はファイルをまたぐので、pre-commit hook でもステージした内容ではなく作業ツリー全体を検査します。意図した重複は `// jscpd:ignore-start` と `// jscpd:ignore-end` で囲み、理由を書きます。
- `pnpm lint:unused` (Knip): pnpm workspace の全てのプロジェクトとルートで、どこからも使われていないファイル、export、依存を見つけると失敗します ([ADR 0017](../adr/0017-knip-unused-code.md))。設定は `knip.jsonc` です。
  Knip が読めない場所 (シェルスクリプト、Kiro の設定など) からだけ使うファイルや依存は、`knip.jsonc` に例外として個別に書き、理由をそのそばに書きます。意図して残す export には `/** @public */` と理由を書きます。不要になった例外も失敗します (`treatConfigHintsAsErrors`)。
  未使用かどうかはほかのファイルの import で決まるので、pre-commit hook でもステージした内容ではなく作業ツリー全体を検査します。
- build の後に `git status` が空であること (`nx` の job の「Generated files are committed」): `routeTree.gen.ts` などの生成ファイルを commit し忘れると失敗します。この step の `run:` は、`src/configs/ci-generated-files.tools.test.ts` が `ci.yml` から取り出して実行し、変更を残した build で止まることを確かめます。

## coverage の下限

テストの強さの基準は [Issue #30](https://github.com/yokozi-jp/agent-software-factory/issues/30) の決定です。`apps/api`、`tools/scripts`、`tools/lint-plugins` の `test` が、Vitest の coverage (provider は v8) で次の 2 つを確かめ、満たさなければ失敗します。ゲートは `nx` の job の `nx affected -t test` です。

- ファイルごとの下限: lines と branches が 90% (`coverage.thresholds.perFile`)。`include` が全てのソースファイルを数えるので、テストのない新しいファイルを足すと止まります。
- 全体の値のラチェット: `thresholds.autoUpdate` に `Math.floor` で丸める関数を渡しているので、全体の値が下限を上回った実行は、その値を `vite.config.ts` に書き戻します。テストを消して全体の値が下がると止まります。

対象から外すのは、実行環境ごとの入口 (`apps/api/src/server.ts`、`vp dev` の入口の `apps/api/src/index.ts`、`tools/scripts` の `cli.ts`)、テストファイル、lint の検出力を確かめる fixture (`apps/api/src/__fixtures__/`) です。fixture はわざと規則に違反する文を持ち、どこからも import されないので、0% と数えられて下限を割ります。`apps/web` にはまだ coverage がなく、最初の component test を足すときに `--passWithNoTests` を外して同じ基準を入れます。そのときは、生成物 (`routeTree.gen.ts`) と入口 (`main.tsx`) を対象から外します。

ファイルごとの下限で止まったら、そのファイルの、通っていない行と分岐を確かめるテストを足します。下限を下げたり、ファイルを `exclude` に足したりはしません。テストで通せない分岐 (型のためだけの `??` など) には、理由を添えて `/* v8 ignore next -- <理由> */` を書きます。

上がった下限は commit します。CI で書き換わると、「Generated files are committed」の step が `vite.config.ts` の差分を出して失敗します。書き換わった `vite.config.ts` は `test` の target の入力なので、次の実行は Nx の cache を使わずにテストを走らせ直します。

## 検査を足すとき

検査はローカルと CI で同じコマンドを呼ぶので、1 つ足すと次の場所を全部直します。`pnpm lint:dup` (jscpd) を足した PR #91 が例です。

1. コマンド: リポジトリ全体を見る検査は、`tools/scripts/src/checks/<name>/` の TypeScript (`node tools/scripts/src/checks/<name>/cli.ts` で実行) か、ルートの `package.json` の script にします。1 つの CLI に引数を渡すだけなら、`tools/scripts/sh/<name>.sh` の sh でも構いません ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md))。プロジェクトごとの検査は、そのプロジェクトの `package.json` の script にし、Nx の target として動かします。どちらも `vp run` は使いません ([ADR 0002](../adr/0002-nx-orchestrates-vite-plus.md))。道具の版は、npm で配られるものは `pnpm-workspace.yaml` の catalog で、それ以外は `mise.toml` で固定します ([ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。
2. `ci.yml` の job に step を足します。mise の道具を使う検査と `test-tools` は `scripts` に、それ以外でリポジトリ全体を見る検査は `checks` に、プロジェクトごとの検査は `nx` に入れます。新しい job を作るなら `main` の `needs` に足します。
3. `lefthook.yml` の `pre-commit` に job を足します。`glob` には、検査の対象のファイルと、道具の版を固定するファイル (`pnpm-workspace.yaml` か `mise.toml` と `mise.lock`) を入れます。
4. [保証カタログ](assurance-catalog.md) に行を足します。名前の列は設定の名前 (`ci.yml: <step の name>` など) にし、lefthook の job は写す行の「ローカルの写し」の列に書きます。Kiro の hook の検査は、ファイルの 1 行目を `// block-<名前>:` か `// warn-<名前>:` で始め、`kiro: <hook>/<名前>` の行を足します。行を書き忘れると repo-policy が止めます。「検出力の確かめ方」には、下の 5 で書くテストのファイルを書きます。GitHub の上でだけ動くもの (ruleset の規則、必須チェック) は、repo-policy の静的な検査と、その PR で手で一度止まることを確かめたことを書きます。
5. 止めるべき入力で失敗し、通すべき入力で通ることを確かめます。TypeScript の検査は `tools/scripts` の Vitest のテスト (下の「スクリプトのテスト」) にします。sh のラッパーは `tools/scripts/src/sh/<name>.test.ts` に、止める入力と通す入力を stub の道具 (`src/test/stubs.ts`) で確かめるプロセスのテストを書きます。本物の道具と設定を使うテストは `*.tools.test.ts` にし、読む設定を `test-tools` の `inputs` に書きます。実行権限の付け忘れは repo-policy が止めます。
6. docs: この文書の「ci.yml の検証」に実行のしかたを、[開発コマンド](commands.md) の構成とコマンドの表に、手で実行するコマンドを書きます。
7. 道具や設定を選んだ理由は ADR に書きます。番号は `node tools/scripts/src/checks/check-adr-number/cli.ts` で決めます ([並行作業と worktree](worktrees.md#pr-を出す))。

## スクリプトのテスト

スクリプトと hook のテストは、すべて `tools/scripts` の TypeScript のテストです。止めるべき入力で止まり、通すべき入力を通すかを確かめます。sh のテストは [Issue #158](https://github.com/yokozi-jp/agent-software-factory/issues/158) の手順で Vitest に移し、`scripts/` はなくなりました ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md))。

### tools/scripts のテスト

`tools/scripts` は Nx の project (`scripts`) で、テストは Vitest です。

| target       | 実行するもの                                                                                                                                                                                                                                  | 走る場所                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`       | `unit` と `isolation` の Vitest の project。coverage の下限 (ファイルごとに lines と branches が 90%) とラチェットつき                                                                                                                        | CI の `nx` の job (`nx affected`)、`tools/scripts/**`、`.kiro/hooks/*.json`、Nx の `sharedGlobals` のどれかのファイルを変えた commit の pre-commit (`nx test scripts`)                                   |
| `mutation`   | `src/` の純粋な関数への Stryker (`--incremental`、`stryker.config.mjs`)。score が `break` (100) を下回ると失敗。PR のゲートではなく、`mutation.yml` が1日1回と手動で実行する                                                                  | CI の `nx` の job (`nx affected`)                                                                                                                                                                        |
| `test-tools` | `tools` の Vitest の project (`*.tools.test.ts`): 本物の道具 (iwe、mise の betterleaks、Semgrep、shellcheck、jactionlint、zizmor、OSV-Scanner、`pnpm dlx` の Renovate、jscpd、Knip、markdownlint-cli2、commitlint) を本物の設定で動かすテスト | CI の `scripts` の job (`nx affected -t test-tools`)、`secret-scan.yml` (secret-scan のものだけ)、それに関わるファイルを変えた commit の pre-commit (`nx test-tools scripts`。[Git hooks](git-hooks.md)) |

- 規則は純粋な関数 (`src/checks/<名前>/rules.ts`) にし、その場で呼ぶテスト (`rules.test.ts`) で確かめます。入口 (`cli.ts`) は、argv、標準入力、環境変数、git を読んで出力するだけにし、少数のプロセスのテスト (`cli.test.ts`) で、sandbox の中の git を使って確かめます。入口は子プロセスで動き coverage が見えないので、coverage と Stryker の対象から外しています。
- Kiro の hook も同じ形です。検査ごとの規則は `src/hooks/<検査>.ts`、入口は trigger ごとに `src/hooks/pre-tool-use/cli.ts` と `src/hooks/session-start/cli.ts` です。入口のプロセスのテストは、Kiro が送る形の event の JSON を標準入力に入れ、exit コード (0 か 2)、stderr、stdout を確かめます。
- テストは宣言していない入力を読みません。`test` のテストは project の中のファイル (fixture) だけを読みます。例外の `.kiro/hooks/*.json` (`src/hooks/kiro-hooks.test.ts` が入口のパスと `matcher` を確かめる) は、`test` の `inputs` に書いてあります。本物の道具と設定を使うテストは `*.tools.test.ts` にし、読む設定ファイルを `tools/scripts/package.json` の `test-tools` の `inputs` に `{workspaceRoot}/…` でファイルごとに書きます。書かないと、その設定を変えても `nx affected` がテストを走らせず、cache が古い結果を返します。
- 外の CLI (`gh`、`mise`、`pnpm`) を呼ぶ入口の `cli.test.ts` と、`tools/scripts/sh/*.sh` のテスト (`src/sh/<名前>.test.ts`) は、sandbox の `PATH` の先頭に置いた stub (`src/test/stubs.ts` の `stubDir`) で、渡す引数と exit コードの扱いを確かめます。ネットワークは使いません。道具がない場合は、`onlyCommands` で作った `PATH` で確かめます。
- `src/sh/<名前>.tools.test.ts` は、同じラッパーを本物の道具で動かします (shellcheck、jactionlint と zizmor、OSV-Scanner、Renovate)。`src/configs/*.tools.test.ts` は、ラッパーを持たない道具 (jscpd、Knip、markdownlint-cli2、commitlint) と、`ci.yml` の step を、このリポジトリの本物の設定で確かめます。Knip のテストは、設定が読む root のファイルと `tools/` を sandbox にコピーし、`apps/` はテストの中に書いた小さなアプリで置き換えて動かします。本物のアプリを読むと、アプリだけを変えた PR で `scripts` が affected になり、`tools/scripts` のテストが走ってしまうためです。
- `runIn` は `HOME` を sandbox にします。mise のディレクトリの既定は `HOME` の下なので ([mise の Directories](https://mise.jdx.dev/directories.html))、そのままだと `mise exec` は sandbox の中に道具をすべて入れ直します (2026-10-26 に mise 2026.10.17 で確かめ、約 70 秒かかりました)。`*.tools.test.ts` は `miseDirs()` (`src/test/sandbox.ts`) を `runIn` に渡し、`mise install --locked` で入れた道具を使います。
- Stryker は、変更する対象を import するテストを project に関係なく sandbox のコピーで走らせます。本物のワークスペースを読む `tools` の project は、Stryker の実行中 (`STRYKER_MUTATOR_WORKER`) は `include` を空にして外します (`vite.config.ts`)。
- `mutation` は生き残った mutant が 1 つでもあると失敗します (`break` が 100)。PR の CI では動かないので、`rules.ts` を変えたら push の前に、そのファイルだけを手元で変異させます。`tools/scripts` で `pnpm exec stryker run --mutate src/checks/<名前>/rules.ts` を実行し、出力の `[Survived]` の行が、消すか書き換えても通ってしまったコードです。小さい `rules.ts` なら数秒で終わります。最初の実行は、`rules.ts` が大きいと十数分かかります (`repo-policy` で約 13〜19 分、他のセッションが動いていて load average が 20 前後のとき)。出力は `> /tmp/stryker.log 2>&1` でファイルに出し、`All files` の行と `[Survived]` の行を読みます。結果は `reports/stryker-incremental.json` (git では無視) に残り、次の実行で変わらない mutant は再利用されます。
  生き残った mutant は、その違いで失敗するテストを足して殺します。振る舞いが変わらない mutant (等価な mutant) は、同じ値を返す書き方にコードを直すか、その行の前に `// Stryker disable next-line <mutator>: equivalent, <理由>` を書きます。
- アプリだけを変えた PR では、`tools/scripts` のテストは走りません。`ci.yml` の `nx` の job の「An app change does not affect tools/scripts」の step が、`apps/api` と `apps/web` のファイルを変えたときに `scripts` が affected にならないことを確かめます。`tools/scripts` の target が、アプリのコードに及ぶ `inputs` を宣言すると、この step が失敗します。

git を使うテストは、このリポジトリを触らないように次の規則を守ります。

- 一時的なリポジトリは `sandbox()` (`src/test/sandbox.ts`) の中に作ります。git は `gitIn(dir, args)` で、ほかのコマンドは `runIn(dir, command, args)` で起動します。どちらも `dir` が sandbox の外なら例外にし、`HOME` を sandbox にします。
- テストのファイルは `node:child_process` を import できません (ルートの `vite.config.ts` の `no-restricted-imports`)。この規則が効いていることは、`src/test/fixtures/child-process.test.ts` の `oxlint-disable-next-line` が確かめます。規則が外れると、使われない disable のコメントで `vp check` が失敗します。
- Vitest の `setupFiles` (`src/test/setup.ts`) が、git が hook の中で設定する `GIT_DIR`、`GIT_INDEX_FILE` など (`git rev-parse --local-env-vars`) を消し、ユーザーとシステムの git の設定を読まないようにし、`GIT_ALLOW_PROTOCOL=file` でネットワーク越しの git を禁じます。
- `src/test/isolation.test.ts` (`unit`) は、decoy のリポジトリを指す hook の変数を設定し、decoy を作業ディレクトリにして `unit` の project のテストを子プロセスで動かし、decoy が変わらないことを確かめます。`gitIn` を通さずに作業ディレクトリのリポジトリや hook の変数が指すリポジトリを変えるテストを足すと、このテストが失敗します。fingerprint を取るのは decoy だけなので、動的な `import()` で `node:child_process` を読み込み、`git -C <このリポジトリの絶対パス>` のように別のリポジトリをパスで指定するテストは見つかりません。この場合は、静的な import を止める `no-restricted-imports` と、レビューで守ります ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md) の「隔離」)。
