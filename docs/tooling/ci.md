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
| `ci.yml`                | PR、main への push | 下の検証と `nx affected -t check test build` と `nx affected -t lint-effect` (5 つの job を並列に実行し、`main` でまとめる)                                                                |
| `commitlint.yml`        | PR                 | PR タイトルと PR 内の全コミットを検証                                                                                                                                                      |
| `secret-scan.yml`       | PR、main への push | secret-scan の `*.tools.test.ts` (本物の betterleaks のテスト) とその隔離の後、PR は PR のコミットを、main は全履歴を betterleaks で scan                                                  |
| `dependency-review.yml` | PR                 | PR が足した依存に、重大度 high 以上の既知の脆弱性があれば失敗する (`actions/dependency-review-action`、runtime と development の両方。[ADR 0021](../adr/0021-sast-and-dependency-scan.md)) |
| `issue-tracker.yml`     | 毎週月曜、手動     | open な Issue の消えたパス、地図の実施の Issue の漏れ、`Blocked by:` の張り忘れた辺を報告する。必須チェックではない ([Issue tracker](../agents/issue-tracker.md#検査))                     |
| `release.yml`           | 手動               | `nx release` ([リリース](../repository/release.md))                                                                                                                                        |

CodeQL は workflow のファイルを持たない default setup で、GitHub が PR と main を解析します。merge を止めるのは ruleset の `code_scanning` の規則です ([GitHub リポジトリの設定](../repository/github-settings.md))。

## ci.yml の job

`ci.yml` は 6 つの job で、`checks`、`scripts`、`osv-scanner`、`nx`、`migration-compat` を並列に実行し、最後に `main` が結果をまとめます。`main` 以外は `setup-vp` か mise で道具を入れます。

| job                | 内容                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks`           | mise の道具を使わない検査: repo policy、Renovate の設定、skills-lock、adr-check、test-weakening、Markdown、docs、root、jscpd、Knip                                                                                                                                                                |
| `scripts`          | mise で入れた道具を使う検査と、道具を動かすテスト: shellcheck、jactionlint と zizmor、Semgrep、`nx affected -t test-tools`、API の契約の検査 (Spectral と oasdiff)                                                                                                                                |
| `osv-scanner`      | `pnpm-lock.yaml` の既知の脆弱性を OSV-Scanner で警告する。`security-events: write` を持つのはこの job だけで、main への push のときだけ SARIF を Code scanning に送る ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))                                                                       |
| `nx`               | `nx affected -t check test build` (`tools/scripts` を含む)、`nx affected -t db-types-check` (DB の型と migration のずれ)、`nx affected -t i18n-keys` (文言のキーの欠落と未使用)、`nx affected -t lint-effect` ([Effect の検査](effect-lint.md))、build の後に生成ファイルが commit 済みであること |
| `main`             | `checks`、`scripts`、`osv-scanner`、`nx`、`migration-compat` のどれかが成功しなかったら失敗する。ruleset の必須チェック (`protect-main`) はこの名前を指す                                                                                                                                         |
| `migration-compat` | PR の migration を適用した DB で、PR の base の版のアプリの結合テストを流す ([ADR 0037](../adr/0037-migration-compatibility-test-against-base.md))                                                                                                                                                |

`main` は、必須チェックの名前を `main` のまま残すための job です。job を足すときは、`main` の `needs` にも足します。足さないと、その job が失敗しても merge できます。
`main` の `if: always()` は、`needs` の job が失敗したときも `main` を実行して失敗させるために要ります。`always()` がないと、`needs` の job が失敗または skip されたとき `main` も skip されます ([GitHub Docs の workflow syntax の `jobs.<job_id>.needs`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax))。必須チェックでは skip が成功として扱われます ([GitHub Docs の About status checks](https://docs.github.com/articles/about-status-checks))。

## ci.yml の検証

どれも、対応するファイルを変えたときに pre-commit hook でも実行します (pre-push hook は、`nx affected -t test` も実行し、影響を受ける project の coverage の下限を push の前に確かめます。adr-check と test-weakening は pre-push hook で実行し、そのテストは `tools/scripts` を変えた commit の pre-commit hook で `nx test scripts` として実行します)。どの hook の job がどの検証の写しかは、[保証カタログ](assurance-catalog.md) の「ローカルの写し」の列にあります。

- `node tools/scripts/src/checks/repo-policy/cli.ts` (repo-policy): ADR の決定を機械的に確認します (`@nx/vite` がない、`vite.config.ts` に `run` がない、`.vite-hooks` がない、betterleaks のバージョンが一致している、ADR の番号が重複していない、`db/migrations/*.sql` の down が `RAISE EXCEPTION` だけで、up が `SET LOCAL lock_timeout` で始まる (`transaction:false` を除く)、Node.js のメジャー版が `.node-version`・`engines.node`・`@types/node` の catalog・`vite.config.ts` の build target でそろっている、`compose.local.yaml` の PostgreSQL のイメージのタグ (digest の前) が `postgresImage` と同じ、`ci.yml` の `main` 以外の全ての job が `main` の `needs` に入っている、`vite.config.ts` で `"error"` にした lint の規則とルートの `tsconfig.json` で有効にした検査のフラグのすべてに fixture がある、project の `tsconfig.json` がルートを `extends` し検査のフラグを設定していない、`docs/` (ADR を含む) がインラインコードで挙げた `tools/`、`packages/`、`apps/`、`types/`、`.github/`、`.kiro/` 以下のファイルが存在する。ディレクトリ、glob、行番号つきのパスは対象外。ADR が当時のパスや採らなかった案のファイルを挙げるときは、インラインコードにしないかディレクトリで書く)。CI は作業ツリーを、pre-commit は `staged` を付けてステージした内容を検査します。ステージしていない他のファイルの編集で、コミットが止まらないようにするためです。
  `docs/` の外 (スクリプト、設定、`AGENTS.md`、workflow) に書いた `docs/...md` のパス、`docs/...md ("見出し")` の見出し、`docs/adr/NNNN` の番号が実在することも確認します。見出しは番号を付けずに書きます。
  `ci.yml` の `main` が必須チェックをまとめる job のとき、`needs` に入っていない job は、失敗しても merge を止めません。そこで、`main` 以外の job が全て `needs` に入っていることを確認します。`needs` は 1 つの job の id でも、job の id のリストでも書けます ([GitHub Docs の workflow syntax の `jobs.<job_id>.needs`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax))。リストは 1 行の配列でも、複数行のリストでも読みます。`ci.yml` がなければ失敗します。
  `tools/scripts/sh/*.sh` が、`git init`、`git clone`、`git -C`、`--git-dir`、`GIT_DIR=` で別のリポジトリを操作していないことも確認します。Git hook の中で動くと、hook を動かしたリポジトリに効くためです (理由は「スクリプトのテスト」)。別のリポジトリが要るテストは TypeScript で `gitIn` を通して書きます。TypeScript は対象外です。文字の並びでは `execFileSync("git", ["-C", …])` を見つけられないので、lint の規則と `isolation.test.ts` が守ります ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md))。
  `tools/scripts/sh/*.sh` の mode が `100755` であることも確認します。
  `ci.yml` が `nx affected` と `nx run-many` の `-t` (`--targets`) で動かす Nx の target が、どれも [開発コマンド](commands.md) の inline code の nx のコマンドにあることも確認します。手で同じ検査を動かせるようにするためです (下の「検査を足すとき」の 6)。
  `pnpm-workspace.yaml` の catalog (`catalog` と `catalogs`) に `workspace:` の版がないことも確認します。`catalogMode: prefer` の下で `pnpm add <package>@workspace:*` を実行すると、pnpm は workspace の package を catalog に入れ、`package.json` には `catalog:` を書きます。workspace の package への依存は、`package.json` に `"workspace:*"` を書いて `pnpm install` します。
  `packages/` の各 package の `package.json` の `name`、`exports` (`./src/index.ts` だけ。`packages/ui`、`packages/db`、`packages/telemetry`、`packages/logging` は [ADR 0034](../adr/0034-shared-ui-package.md)、[ADR 0038](../adr/0038-db-package.md)、[ADR 0048](../adr/0048-opentelemetry-traces-only-with-explicit-instrumentation.md)、[ADR 0049](../adr/0049-logging-with-pino-behind-a-logger-interface.md) の形)、`nx.name`、`check` の script (`vp check`) が決めた形であること、依存が、モジュールの依存の向き (締め → 承認 → 申請。`tools/scripts/src/checks/repo-policy/modules.ts` の `moduleOrder`) に従うこと、tag `type:module` の付いた package が `moduleOrder` と `apps/api` (`package.json`、`databases.ts`、`app.ts`) に登録されていること、`packages/db` がモジュールに `devDependencies` だけで依存し、`packages/db` に依存する package が `apps/api` と `apps/worker` だけであること、tsconfig の `paths` (自分の `./src/` だけを指すものは除く、[ADR 0033](../adr/0033-shadcn-base-ui-tailwind-v4-storybook.md)) と `baseUrl`、`vite.config.ts` の `alias`、pnpm の hoist の設定で、宣言していない package を解決できるようにしていないこと、各モジュールの `lint-effect` の script が同じであることを確認します。`src/` と各層 (`vite.config.ts` の `layers`) について、いずれかの package の `__fixtures__/` に `oxlint-disable-next-line no-restricted-imports` を書いた fixture があることも確認します ([ADR 0026](../adr/0026-modules-as-packages-with-oxlint-boundaries.md))。`vite.config.ts` の `layers` に `domain` があれば、いずれかの package (`packages/module-fixtures`) の `src/domain/__fixtures__/` に、`domain/no-throw`、`no-restricted-globals`、`no-restricted-properties` の disable のコメントを書いた fixture があることも確認します ([ADR 0027](../adr/0027-domain-model-as-pure-functions-and-unions.md))。禁止の表 (`lint-restrictions.json`) の行と、その fixture の行が、両方向に合うことも確認します (下の「禁止の表」、[ADR 0050](../adr/0050-lint-restrictions-table-in-json.md))。
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
- `tools/scripts/sh/openapi-lint.sh` と `tools/scripts/sh/openapi-breaking.sh`: API の契約 `apps/api/openapi.json` の検査で、`pnpm exec nx contract-lint api` と `nx contract-breaking api` が呼びます ([ADR 0047](../adr/0047-api-contract-with-zod-openapi-and-hc.md)、[Issue #190](https://github.com/yokozi-jp/agent-software-factory/issues/190))。前者は Spectral (規則は `.spectral.yaml`) で、spec の書き忘れと、4xx と 5xx が Problem Details でないこと、POST か PATCH の operation が `Idempotency-Key` を必須の header に持たないこと ([ADR 0040](../adr/0040-idempotency-key-in-module-schema.md)) を止めます。後者は oasdiff で、PR の base (`origin/main`) の spec との破壊的変更 (ERR) を止め、WARN は job の要約に出します。後者は PR だけで動きます。破壊的変更の例外ファイルはありません。止まったら、新しい形を足して古い形に `deprecated: true` と `x-sunset` を付け、日付を過ぎてから別の PR で消します ([versioning](../web-api/versioning.md))。版は mise で固定します。
- `node tools/scripts/src/checks/semgrep/cli.ts` (Semgrep): Semgrep CE の SAST で、PR の base (`origin/$GITHUB_BASE_REF`、なければ `origin/main`) との merge base になかった ERROR の指摘だけで失敗します ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))。規則は Semgrep Registry の `p/typescript` と `p/react` で、実行のたびに取り寄せるのでネットワークが要ります。base にすでにある指摘と、ERROR より軽い指摘は、CodeQL の code scanning の alert で扱います。
  終了コードは、新しい指摘が 1、検査できなかった (mise がない、base がない、Semgrep の失敗) ときが 2 以上で、CI はどちらも失敗にします。指摘を抑えるときは、その行に `nosemgrep: <rule-id>` と理由を書きます。
  Semgrep は PyPI にしかないので、mise の `pypi` backend が uv で入れます。依存のグラフ (wheel の hash) は `.mise/locks/pypi-semgrep/<版>/uv.lock` にあり、`mise.lock` がその digest を記録します。`mise lock` を実行したら `.mise/locks/` も commit します。
- `tools/scripts/sh/osv-scanner.sh`: OSV-Scanner で `pnpm-lock.yaml` の既知の脆弱性を一覧にし、見つけたら `::warning::` を出します。job は失敗させません。環境変数 `OSV_SARIF_FILE` があれば、その path に SARIF も書きます (`ci.yml` の `osv-scanner` job が、main への push のときだけ `upload-sarif` で Code scanning に送ります。`category: osv-scanner` で CodeQL と分けます) ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))。依存のゲートは `dependency-review.yml` です。osv.dev に問い合わせるので、ネットワークが要ります。問い合わせに失敗したら、そう警告して通します。脆弱性を無視するときは、`osv-scanner.toml` の `[[IgnoredVulns]]` に理由を書きます。
- `node tools/scripts/src/checks/skills-lock/cli.ts` (skills-lock): `.agents/skills` が `skills-lock.json` の記録と一致し、`.kiro/skills` に各 skill への symlink があることを確認します。skill は upstream からインストールしたものなので、手で編集しません。
- `pnpm lint:md`: 全ての Markdown を markdownlint-cli2 で検査します。
- `node tools/scripts/src/checks/docs-check/cli.ts` (docs-check): `docs/` を OKF v0.2 バンドルとして検査します ([docs の書き方](../knowledge/documentation-authoring.md))。引用符のない frontmatter の値に、コロンと空白、または空白と `#` が続く部分があると、YAML が壊れて iwe が必須項目の欠落と誤って報告するので、その原因を先に示します。文書へのリンクが `.md` で終わることも見ます (GitHub は拡張子のないリンクをたどれません)。CI は `staged` を付けずに実行するので、`about.md` の記録の検査は pre-commit だけで行います。
- `tools/scripts/sh/renovate.sh validate`: `renovate.jsonc` を、`tools/scripts/sh/renovate.sh` に固定した版の Renovate の `renovate-config-validator --strict` で検査します ([Renovate](renovate.md))。`pnpm dlx` で Renovate を取るので、ネットワークが要ります。
- `pnpm check:root` (`tools/scripts/sh/check-root-files.sh`): `apps/`、`packages/`、`tools/` の外にあるファイル (ルートの設定ファイル、`docs/`、`.github/` など) に `vp check` を実行します。
  各プロジェクトの `check` は Nx のプロジェクトの中のファイルしか見ないので、これらのファイルはこのステップで検査します。
  対象は `git ls-files` で選ぶので、commit していない作業用のファイルは検査しません。
  pre-commit hook では、ステージしたファイルに `vp check --fix` を実行します。
- `pnpm lint:dup` (jscpd): `apps/` と `packages/` の JavaScript、TypeScript、CSS の重複を検査し、重複率が `.jscpd.json` の `threshold` を超えると失敗します ([ADR 0014](../adr/0014-jscpd-duplication-threshold.md))。
  `.gitignore` の対象 (`dist`、`.tanstack/` など)、生成物 (`routeTree.gen.ts`、`db.gen.ts`)、テストの fixture は対象外です。閾値の値と、それを決めた理由は ADR 0014 に書きます。clone はファイルをまたぐので、pre-commit hook でもステージした内容ではなく作業ツリー全体を検査します。意図した重複は `// jscpd:ignore-start` と `// jscpd:ignore-end` で囲み、理由を書きます。
- `pnpm lint:unused` (Knip): pnpm workspace の全てのプロジェクトとルートで、どこからも使われていないファイル、export、依存を見つけると失敗します ([ADR 0017](../adr/0017-knip-unused-code.md))。設定は `knip.jsonc` です。
  Knip が読めない場所 (シェルスクリプト、Kiro の設定など) からだけ使うファイルや依存は、`knip.jsonc` に例外として個別に書き、理由をそのそばに書きます。意図して残す export には `/** @public */` と理由を書きます。不要になった例外も失敗します (`treatConfigHintsAsErrors`)。
  未使用かどうかはほかのファイルの import で決まるので、pre-commit hook でもステージした内容ではなく作業ツリー全体を検査します。
- `nx affected -t db-types-check` (`nx` の job の「DB types match the migrations」): testcontainers の PostgreSQL に migration を流し、kysely-codegen でモジュールのスキーマごとに型を生成し直し、commit された `packages/*/src/infrastructure/db.gen.ts` と違えば失敗します ([ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md))。migration を変えたら `pnpm exec nx db-types db` で型を生成し直して commit します ([PostgreSQL のクライアント管理](../db/postgresql-client.md))。
  入口は `packages/db/src/types.ts` で、ずれを見つける関数のテストは `packages/db/src/types.test.ts` です。PostgreSQL のコンテナを起動する (約 10 秒) ので、pre-commit の hook (`db-types`) は migration、生成した型、生成の入口、`pnpm-workspace.yaml` のどれかを変えた commit でだけ実行します。
- `nx affected -t i18n-keys` (`nx` の job の「Text keys match the code」): `i18next-cli status` (キーの欠落) と `status --unused` (使われないキー) を、画面の文言 (`packages/i18n/src/locales/{ja,en}/translation.json`) と、それを使うコード (`apps/web/src` と `packages/i18n/src`) に流し、揃っていなければ失敗します ([ADR 0044](../adr/0044-i18next-for-texts.md))。target は `web` に置き、スクリプトが `packages/i18n` に移ってから CLI を流します。`web` は `packages/i18n` に依存するので、どちらを変えても affected になり、プロジェクトの依存に循環は生じません。コメントとテストの `t("…")` は使われている印にしません。`t` に渡すキーは文字列で書きます (組み立てたキーは検出できません)。`t(...)`、`i18n.t(...)`、`useTranslation()` が返す `t` の第 1 引数がリテラルでないと、`vp check` の `i18n/literal-key` が止めます。pre-push の hook (`nx-affected-i18n-keys`) も同じ target を実行し、Nx のキャッシュで結果が変わらなければすぐ終わります。
- `node tools/scripts/src/checks/migration-compat/cli.ts` (更新の試験、`migration-compat` の job): PR の migration を適用した DB で、切り戻し先の前の版のアプリが動くことを確かめます。前の版は PR の base の commit で代用します ([ADR 0037](../adr/0037-migration-compatibility-test-against-base.md))。
  - 起動と成功: すべての PR で起動し、`packages/db/migrations/**` に差分がなければ成功で終えます。base に seed の入口 (`packages/db/src/seed/index.ts`) がないか、base の harness (`packages/db/src/testing/prepare-database.ts`) が環境変数 `MIGRATION_COMPAT_FILES` を読まなければ、`::notice::` を出して成功で終えます。harness が読まない base では、PR の migration を流せず、何も確かめずに通るためです。
  - 先に失敗させるもの: base にある migration の書き換えと削除は、DB の起動前に失敗させます。
  - 流し方: base を `git worktree` に出し、その版の結合テストを coverage なしで全部流します。base は `git worktree` (`$RUNNER_TEMP` か一時ディレクトリ) に出し、`pnpm install --frozen-lockfile` の後、`apps/api` で `vp test run --project integration` を流します。DB には、base の migration、seed、PR が足した migration の順に流します。PR が足した migration のファイルは、環境変数 `MIGRATION_COMPAT_FILES` (絶対 path の JSON の配列) で base の harness に渡します。終了コードは、通ったか対象がなければ 0、base の migration の変更と削除かテストの失敗が 1、base が見つからないなど実行できなかったときが 2 です。
  - 止まったとき: 前の版のアプリが新しいスキーマで動かないということです。互換を壊す変更を expand と contract に分け、contract は前の版のアプリが使わなくなってから出します ([PostgreSQL のスキーママイグレーション](../db/postgresql-migration.md#このリポジトリの-migration-の書き方))。例外のラベルはなく、緊急のときだけ ruleset の bypass で人が通します。
- build の後に `git status` が空であること (`nx` の job の「Generated files are committed」): `routeTree.gen.ts` などの生成ファイルを commit し忘れると失敗します。この step の `run:` は、`src/configs/ci-generated-files.tools.test.ts` が `ci.yml` から取り出して実行し、変更を残した build で止まることを確かめます。

## coverage の下限

テストの強さの基準は [Issue #30](https://github.com/yokozi-jp/agent-software-factory/issues/30) の決定です。`apps/api`、`apps/web`、`apps/worker`、`packages/db`、`tools/scripts`、`tools/lint-plugins` の `test` が、Vitest の coverage (provider は v8) で次の 2 つを確かめ、満たさなければ失敗します。ゲートは `nx` の job の `nx affected -t test` です。

- ファイルごとの下限: lines と branches が 90% (`coverage.thresholds.perFile`)。`include` が全てのソースファイルを数えるので、テストのない新しいファイルを足すと止まります。
- 全体の値のラチェット (`packages/db` には掛けず、ファイルごとの下限だけ掛けます。[ADR 0038](../adr/0038-db-package.md)): `thresholds.autoUpdate` に `Math.floor` で丸める関数を渡しているので、全体の値が下限を上回った実行は、その値を `vite.config.ts` に書き戻します。テストを消して全体の値が下がると止まります。

対象から外すのは、実行環境ごとの入口 (`apps/api/src/server.ts`、トレースを始める `apps/api/src/telemetry.ts`、`vp dev` の入口の `apps/api/src/index.ts`、`tools/scripts` の `cli.ts`)、テストファイル、lint の検出力を確かめる fixture (`apps/api/src/__fixtures__/`) です。fixture はわざと規則に違反する文を持ち、どこからも import されないので、0% と数えられて下限を割ります。`apps/web` は、`src/` の `*.test.ts` (unit) と story (`play`) の両方が通した行を数えます。対象から外すのは、生成物 (`routeTree.gen.ts`)、入口 (`main.tsx`)、story です。`src/routes/` の route も数えます ([Issue #406](https://github.com/yokozi-jp/agent-software-factory/issues/406))。route の HMR 用のコードは、テストでは動かず route のファイルの最後の行が未通過と数えられるので、`vite.config.ts` が `VITEST` の環境変数があるとき (テスト) だけ外します。`packages/ui` の部品は、story で確かめますが coverage には数えません (`packages/ui` に専用のテストは書かない。[ADR 0033](../adr/0033-shadcn-base-ui-tailwind-v4-storybook.md))。

ファイルごとの下限で止まったら、そのファイルの、通っていない行と分岐を確かめるテストを足します。下限を下げたり、ファイルを `exclude` に足したりはしません。テストで通せない分岐 (型のためだけの `??` など) には、理由を添えて `/* v8 ignore next -- <理由> */` を書きます。

上がった下限は commit します。CI で書き換わると、「Generated files are committed」の step が `vite.config.ts` の差分を出して失敗します。書き換わった `vite.config.ts` は `test` の target の入力なので、次の実行は Nx の cache を使わずにテストを走らせ直します。

## 検査を足すとき

検査はローカルと CI で同じコマンドを呼ぶので、1 つ足すと次の場所を全部直します。`pnpm lint:dup` (jscpd) を足した PR #91 が例です。

1. コマンド: リポジトリ全体を見る検査は、`tools/scripts/src/checks/<name>/` の TypeScript (`node tools/scripts/src/checks/<name>/cli.ts` で実行) か、ルートの `package.json` の script にします。1 つの CLI に引数を渡すだけなら、`tools/scripts/sh/<name>.sh` の sh でも構いません ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md))。プロジェクトごとの検査は、そのプロジェクトの `package.json` の script にし、Nx の target として動かします。どちらも `vp run` は使いません ([ADR 0002](../adr/0002-nx-orchestrates-vite-plus.md))。道具の版は、npm で配られるものは `pnpm-workspace.yaml` の catalog で、それ以外は `mise.toml` で固定します ([ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。
2. `ci.yml` の job に step を足します。mise の道具を使う検査と `test-tools` は `scripts` に、それ以外でリポジトリ全体を見る検査は `checks` に、プロジェクトごとの検査は `nx` に入れます。新しい job を作るなら `main` の `needs` に足します。
3. `lefthook.yml` の `pre-commit` に job を足します。`glob` には、検査の対象のファイルと、道具の版を固定するファイル (`pnpm-workspace.yaml` か `mise.toml` と `mise.lock`) を入れます。
4. [保証カタログ](assurance-catalog.md) に行を足します。名前の列は設定の名前 (`ci.yml: <step の name>` など) にし、lefthook の job は写す行の「ローカルの写し」の列に書きます。Kiro の hook の検査は、ファイルの 1 行目を `// block-<名前>:` か `// warn-<名前>:` で始め、`kiro: <hook>/<名前>` の行を足します。行を書き忘れると repo-policy が止めます。「検出力の確かめ方」には、下の 5 で書くテストのファイルを書きます。GitHub の上でだけ動くもの (ruleset の規則、必須チェック) は、repo-policy の静的な検査と、その PR で手で一度止まることを確かめたことを書きます。lint の規則か tsconfig のフラグを足すときは、下の「lint の規則と tsconfig のフラグの fixture」に従って fixture に 1 行足し、その fixture を「検出力の確かめ方」に書きます。
5. 止めるべき入力で失敗し、通すべき入力で通ることを確かめます。TypeScript の検査は `tools/scripts` の Vitest のテスト (下の「スクリプトのテスト」) にします。sh のラッパーは `tools/scripts/src/sh/<name>.test.ts` に、止める入力と通す入力を stub の道具 (`src/test/stubs.ts`) で確かめるプロセスのテストを書きます。ラッパーにこのテストがないと、repo-policy が止めます。本物の道具と設定を使うテストは `*.tools.test.ts` にし、読む設定を `test-tools` の `inputs` に書きます。実行権限の付け忘れは repo-policy が止めます。
6. docs: この文書の「ci.yml の検証」に実行のしかたを、[開発コマンド](commands.md) の構成とコマンドの表に、手で実行するコマンドを書きます。`ci.yml` の Nx の target がコマンドの表にないと、repo-policy が失敗します。
7. 道具や設定を選んだ理由は ADR に書きます。番号は `node tools/scripts/src/checks/check-adr-number/cli.ts` で決めます ([並行作業と worktree](worktrees.md#pr-を出す))。

既存の repo-policy に規則を 1 つ足すだけなら、上の 1 から 3 と 7 は済んでいます。直す場所は次の 5 つです (PR #538 が例です)。

- `tools/scripts/src/checks/repo-policy/` の、主題に合う `*.ts` (規則の置き場は `rules.ts` の先頭のコメント) に規則を書き、`rules.ts` の `violations` に並べます。
- 規則が名前で読むファイル (`tree.read("…")`、`tree.parsed("…")`、`tree.named("…")`) を、`lefthook.yml` の `pre-commit` の `repo-policy` の `glob` に足します。足し忘れは `lefthook-inputs.test.ts` が止めます。
- `fixtures/passing-repo.ts` に、規則を通す最小のファイルを足します。
- `rules.test.ts` に、止める入力と通す入力のテストを足します。
- この文書の repo-policy の項に、確かめる内容を足します。

## lint の規則と tsconfig のフラグの fixture

lint の規則 (`vite.config.ts` で `"error"` にしたもの) か、tsconfig の検査のフラグ (ルートの `tsconfig.json`) を足したら、同じ PR で fixture に違反の行を 1 行足します。fixture が、その規則やフラグの検出力を確かめる仕組みです ([#43](https://github.com/yokozi-jp/agent-software-factory/issues/43)、[#230](https://github.com/yokozi-jp/agent-software-factory/issues/230))。

- 規則は、違反の行の前に `// oxlint-disable-next-line <規則> -- 理由` を書きます。フラグは、違反の行の前に `// @ts-expect-error -- fixture: <フラグ>: 理由` を書きます。規則やフラグが外れると、使われない disable のコメントか、使われない `@ts-expect-error` (TS2578) で、普段の `nx affected -t check` (`vp check`) が失敗します。override の `files` が対象のコードに届かなくなったときも同じです。
- 置き場所は、規則が効くコードの project の `__fixtures__/` (`tools/scripts` は `fixtures/`) です。全体にかかる規則は `apps/api/src/__fixtures__/typed-rules.ts`、フラグは `apps/api/src/__fixtures__/tsconfig-flags.ts`、`apps/web/src` の規則は `apps/web/src/__fixtures__/`、テストファイルの規則は `*.test.ts` (`*.test.tsx`) の名前の fixture です。ファイルの先頭のコメントに、何を確かめるかを書きます。
- 規則 1 つに 1 行です。規則の中の個々の値 (`no-restricted-globals` の各名前など) までは確かめません。例外は、下の「禁止の表」に並べた禁止です。値ごと、override の場所ごとに 1 行が要ります。1 行が複数の規則に当たるときは、`oxlint-disable-next-line a, b` とカンマで並べます。
- `import/no-cycle` は、Oxlint 1.89.0 では、ルートの `lint.plugins` に `import` がないと module graph が作られず、override だけで有効にしても何も報告しません (2026-10-30 に確かめました)。そのため `vite.config.ts` のルートで `plugins: ["import", "typescript", "unicorn", "oxc"]` を書いています。`plugins` を書くと Oxlint の既定の plugin が置き換わるので、既定の `typescript`、`unicorn`、`oxc` も並べています。Oxlint を上げたら、ルートの `plugins` から `import` を外して、fixture (`packages/module-fixtures/src/__fixtures__/cycle-a.ts`) が失敗しないかを確かめ、通るなら外します。
- override が外す規則 (`server.ts` や `*.test.ts` の除外) は、注釈のない通常のコードで確かめます。除外が外れると、その行が報告されて失敗します。
- fixture は、Knip (`knip.jsonc` の `ignoreFiles`)、jscpd (`.jscpd.json` の `ignore`。JSON なので理由はここに書く: どこからも import されず、わざと違反する文が重複と数えられるため)、coverage (`apps/api/vite.config.ts` と `tools/scripts/vite.config.ts` の `coverage.exclude`)、Vitest (`apps/api/vite.config.ts`、`apps/web/vite.config.ts`、`tools/scripts/vite.config.ts` の `exclude`)、Stryker (`tools/scripts/stryker.config.mjs` の `mutate`) の対象から外します。理由は、それぞれの設定のコメントにあります。ただし Knip は、`__fixtures__/` の `*.test.ts` を Vitest の入口として読みます。そのため、その fixture は、fixture だけが使う依存を import しません。例外は、止める import の fixture です (下の「禁止の表」の `outbox` の `outbox.test.ts`)。その依存は `knip.jsonc` の `ignoreDependencies` に、理由つきで書きます。
- 書き忘れは repo-policy が止めます。`vite.config.ts` で `"error"` にした規則の名前が `oxlint-disable-next-line` に、ルートの `tsconfig.json` で有効にした検査のフラグの名前が `@ts-expect-error -- fixture: <フラグ>` の行に、fixture のどこかで 1 回以上出ることを確かめます。メッセージに、足す規則かフラグの名前と置き場所の例が出ます。`vite.config.ts` は文字列として読むので、規則は `"名前": "error"` か `"名前": ["error", ...]` の形で書きます。同じ名前の規則が複数の override にあるときも、名前が 1 回出れば足ります。override ごとの fixture は、置く人が上の置き場所に従って足します。
- 対象のフラグは、[TSConfig Reference](https://www.typescriptlang.org/tsconfig/) の「Type Checking」の 20 個と `noUncheckedSideEffectImports` (「Modules」)、`verbatimModuleSyntax`、`erasableSyntaxOnly` です (`rules.ts` の `tsconfigChecks`)。`noEmit` や `module` のように、コードを検査しないものは対象にしません。`tsconfig.json` のコメントは、行全体の `//` だけを読めます。
- project の `tsconfig.json` は、ルートを `extends` し、検査のフラグを設定しません ([ADR 0020](../adr/0020-typescript-strictness.md))。フラグの fixture は 1 つの project (`apps/api`) にあり、ルートのフラグがすべての project に届くことで、全体を確かめたことになります。repo-policy が、`extends` がない、検査のフラグを設定している project の `tsconfig.json` を止めます。
- 手でも確かめます。規則を 1 つ `off` にする、override の `files` を `["nonexistent/**"]` にする、フラグを 1 つ外す、のどれでも `nx affected -t check` が失敗することを、PR の本文に記録します。fixture そのものが、その失敗を起こす仕組みなので、自動のテストにはしません。

### 禁止の表

lint で止める import と呼び出しのうち、値ごとに確かめるものは、ルートの `lint-restrictions.json` (禁止の表) に並べます ([ADR 0050](../adr/0050-lint-restrictions-table-in-json.md))。`vite.config.ts` は表を import して override を組み、repo-policy (`lint-restrictions.ts`) が表と fixture を両方向に突き合わせます。JSON にはコメントを書けないので、列の意味はここに書きます。

表は、禁止ごとの欄 (キー) を持ちます。今の欄は `outbox` (SQS などの SDK のクライアント)、`connection` (`pg`)、`raw-sql` (Kysely の `sql` と `CompiledQuery`)、`with-tables`、`session-setting` (ロールとテナントを変える SQL)、`otel-sdk`、`telemetry-node`、`pino`、`console`、`db-imports` (`packages/db` からの値の import) です。

| 列         | 意味                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adr`      | 禁止を決めた ADR (`docs/adr/0029` の形)。失敗の message と、Oxlint の message に出す                                                                                                            |
| `values`   | `vite.config.ts` が止める値 (パッケージ名、`importNames`、プロパティ、グローバル)。`otel-sdk` はパッケージ名の先頭の文字列で、閉じの引用符で終わる値 (`@opentelemetry/resources"`) は名前の全体 |
| `message`  | Oxlint が出す message。代わりに書くものと ADR を書く。自作の plugin の規則 (`session-setting`) は持たない                                                                                       |
| `mentions` | `message` に要る語 (`enqueueOutbox` など)。repo-policy が、`message` がこの語と `adr` を書くことを確かめる                                                                                      |
| `rows`     | fixture の行                                                                                                                                                                                    |

`rows` の各行は次の列を持ちます。

| 列       | 意味                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `files`  | 行がある fixture。名前は `<dir>/__fixtures__/<キー>.ts`、入口とテストの override には `<キー>.test.ts`                             |
| `rule`   | 止める規則 (`no-restricted-imports` など)                                                                                          |
| `text`   | fixture の行に書く文字列。import はパッケージ名を引用符ごと書き (`"pg"`)、ほかの名前の一部に当たらないようにする                   |
| `expect` | `stop` は、`oxlint-disable-next-line <rule>` の次の行に `text` がある。`pass` は、`text` があり、前の行に disable のコメントがない |
| `reason` | 行が要る理由。行が欠けたときの失敗の message に出す                                                                                |

repo-policy は次の欠けを止めます。どれも、表の行か fixture の行を消したとき、値を足したときに失敗するためです。

- 表の行の `text` が、`files` のどれかの fixture にない。失敗の message は 1 つのひな形で、ファイル、規則、`text` を挙げ、行の `reason` と欄の `adr` を続けます。
- 表の fixture (キーの名前のファイル) の、disable のコメントの次の行、import と re-export の行、欄の `text` を書いた行に、表の行がない。import の行は、ほかの行と `text` を共有しない通す行 (`"node:child_process"`) でも、表の行を消せば失敗するように数えます。
- 欄の `values` のどれかを書いた止める行が、止める行を持つファイルのどれかにない。
- `message` が `mentions` の語か `adr` を書いていない。`files` がキーの名前でない。

`import type` は区別しません。型の import に disable のコメントを書いても使われず、`vp check` が失敗するためです。

禁止を足すときは、欄を足し、`vite.config.ts` で欄の `values` と `message` から override を組み、止める場所と通す場所に `__fixtures__/<キー>.ts` を置いて表の行を足します。値を足すときは、その欄の止める行を持つファイルのそれぞれに、import を 1 行と表の行を足します。override の `files` を広げて新しい層や package に禁止を届けるときは、その場所にも fixture と表の行を足します。表は場所を `layers` から求めないので、足し忘れは機械では止まりません。

## スクリプトのテスト

スクリプトと hook のテストは、すべて `tools/scripts` の TypeScript のテストです。止めるべき入力で止まり、通すべき入力を通すかを確かめます。sh のテストは [Issue #158](https://github.com/yokozi-jp/agent-software-factory/issues/158) の手順で Vitest に移し、`scripts/` はなくなりました ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md))。

### tools/scripts のテスト

`tools/scripts` は Nx の project (`scripts`) で、テストは Vitest です。

| target           | 実行するもの                                                                                                                                                                                                                                                     | 走る場所                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`           | `unit` の Vitest の project。coverage の下限 (ファイルごとに lines と branches が 90%) とラチェットつき                                                                                                                                                          | CI の `nx` の job (`nx affected`)、pre-push の `nx-affected-test`、`tools/scripts/**`、`.kiro/hooks/*.json`、Nx の `sharedGlobals` のどれかのファイルを変えた commit の pre-commit (`nx test scripts`)                                                                                                                                    |
| `test-isolation` | `isolation` の Vitest の project (coverage なし)。`unit` を hook の変数の下で子プロセスで流す                                                                                                                                                                    | `tools/scripts/src/test/**` か `tools/scripts/vite.config.ts` を変えたときだけ (この 2 つは `tools/scripts/package.json` の `test-isolation` の `inputs` だけに書き、CI と pre-push はどちらも `nx affected -t test-isolation` で選ぶ)、CI の `nx` の job (step `Test isolation of the scripts tests`) と pre-push の `nx-test-isolation` |
| `mutation`       | `src/` の純粋な関数への Stryker (`--incremental`、`stryker.config.mjs`)。score が `break` (100) を下回ると失敗。PR のゲートではなく、`mutation.yml` が1日1回と手動で実行する                                                                                     | CI の `nx` の job (`nx affected`)                                                                                                                                                                                                                                                                                                         |
| `test-tools`     | `tools` の Vitest の project (`*.tools.test.ts`): 本物の道具 (iwe、mise の betterleaks、Semgrep、shellcheck、jactionlint、zizmor、Spectral、oasdiff、OSV-Scanner、`pnpm dlx` の Renovate、jscpd、Knip、markdownlint-cli2、commitlint) を本物の設定で動かすテスト | CI の `scripts` の job (`nx affected -t test-tools`)、`secret-scan.yml` (secret-scan のものだけ)、pre-push の `nx-affected-test-tools` (`nx affected -t test-tools`。[Git hooks](git-hooks.md))                                                                                                                                           |

- 規則は純粋な関数 (`src/checks/<名前>/rules.ts`) にし、その場で呼ぶテスト (`rules.test.ts`) で確かめます。入口 (`cli.ts`) は、argv、標準入力、環境変数、git を読んで出力するだけにし、少数のプロセスのテスト (`cli.test.ts`) で、sandbox の中の git を使って確かめます。入口は子プロセスで動き coverage が見えないので、coverage と Stryker の対象から外しています。
- Kiro の hook も同じ形です。検査ごとの規則は `src/hooks/<検査>.ts`、入口は trigger ごとに `src/hooks/pre-tool-use/cli.ts` と `src/hooks/session-start/cli.ts` です。入口のプロセスのテストは、Kiro が送る形の event の JSON を標準入力に入れ、exit コード (0 か 2)、stderr、stdout を確かめます。
- テストは宣言していない入力を読みません。`test` のテストは project の中のファイル (fixture) だけを読みます。例外の `.kiro/hooks/*.json` (`src/hooks/kiro-hooks.test.ts` が入口のパスと `matcher` を確かめる) は、`test` の `inputs` に書いてあります。本物の道具と設定を使うテストは `*.tools.test.ts` にし、読む設定ファイルを `tools/scripts/package.json` の `test-tools` の `inputs` に `{workspaceRoot}/…` でファイルごとに書きます。書かないと、その設定を変えても `nx affected` がテストを走らせず、cache が古い結果を返します。
- 外の CLI (`gh`、`mise`、`pnpm`) を呼ぶ入口の `cli.test.ts` と、`tools/scripts/sh/*.sh` のテスト (`src/sh/<名前>.test.ts`) は、sandbox の `PATH` の先頭に置いた stub (`src/test/stubs.ts` の `stubDir`) で、渡す引数と exit コードの扱いを確かめます。ネットワークは使いません。道具がない場合は、`onlyCommands` で作った `PATH` で確かめます。
- `src/sh/<名前>.tools.test.ts` は、同じラッパーを本物の道具で動かします (shellcheck、jactionlint と zizmor、OSV-Scanner、Renovate、Spectral と oasdiff)。`src/configs/*.tools.test.ts` は、ラッパーを持たない道具 (jscpd、Knip、markdownlint-cli2、commitlint) と、`ci.yml` の step を、このリポジトリの本物の設定で確かめます。Knip のテストは、設定が読む root のファイルと `tools/` を sandbox にコピーし、`apps/` はテストの中に書いた小さなアプリで置き換えて動かします。本物のアプリを読むと、アプリだけを変えた PR で `scripts` が affected になり、`tools/scripts` のテストが走ってしまうためです。このため、`knip.jsonc` の `workspaces` に `entry` を足したり、アプリの構成を変えたりしたら、`tools/scripts/src/configs/knip.tools.test.ts` の小さなアプリにも、その `entry` が指すファイルを足します。`entry` を書くと Knip の既定の entry が外れるので、既定の entry だったファイルへのつながり (`apps/web` なら `index.html` の `<script>`) も要ります。足さないと、このテストが「設定の hint」か「未使用のファイル」で落ちます。落ちるのは pre-push の約 1 分後で、pre-commit では分かりません。
- `runIn` は `HOME` を sandbox にします。mise のディレクトリの既定は `HOME` の下なので ([mise の Directories](https://mise.jdx.dev/directories.html))、そのままだと `mise exec` は sandbox の中に道具をすべて入れ直します (2026-10-26 に mise 2026.10.17 で確かめ、約 70 秒かかりました)。`*.tools.test.ts` は `miseDirs()` (`src/test/sandbox.ts`) を `runIn` に渡し、`mise install --locked` で入れた道具を使います。
- Stryker は、変更する対象を import するテストを project に関係なく sandbox のコピーで走らせます。本物のワークスペースを読む `tools` の project は、Stryker の実行中 (`STRYKER_MUTATOR_WORKER`) は `include` を空にして外します (`vite.config.ts`)。
- `mutation` は生き残った mutant が 1 つでもあると失敗します (`break` が 100)。PR の CI では動かないので、`rules.ts` を変えたら push の前に、そのファイルだけを手元で変異させます。`tools/scripts` で `pnpm exec stryker run --mutate src/checks/<名前>/rules.ts` を実行し、出力の `[Survived]` の行が、消すか書き換えても通ってしまったコードです。小さい `rules.ts` なら数秒で終わります。最初の実行は、`rules.ts` が大きいと十数分かかります (`repo-policy` で約 13〜19 分、他のセッションが動いていて load average が 20 前後のとき)。出力は `> /tmp/stryker.log 2>&1` でファイルに出し、`All files` の行と `[Survived]` の行を読みます。結果は `reports/stryker-incremental.json` (git では無視) に残り、次の実行で変わらない mutant は再利用されます。
  生き残った mutant は、その違いで失敗するテストを足して殺します。振る舞いが変わらない mutant (等価な mutant) は、同じ値を返す書き方にコードを直すか、その行の前に `// Stryker disable next-line <mutator>: equivalent, <理由>` を書きます。
- アプリだけを変えた PR では、`tools/scripts` のテストは走りません。`ci.yml` の `nx` の job の「An app change does not affect tools/scripts」の step が、`apps/api` と `apps/web` のファイルを変えたときに `scripts` が affected にならないことを確かめます。`tools/scripts` の target が、アプリのコードに及ぶ `inputs` を宣言すると、この step が失敗します。

git を使うテストは、このリポジトリを触らないように次の規則を守ります。

- 一時的なリポジトリは `sandbox()` (`src/test/sandbox.ts`) の中に作ります。git は `gitIn(dir, args)` で、ほかのコマンドは `runIn(dir, command, args)` で起動します。どちらも `dir` が sandbox の外なら例外にし、`HOME` を sandbox にします。
- テストのファイルは `node:child_process` を import できません (ルートの `vite.config.ts` の `no-restricted-imports`)。この規則が効いていることは、`src/test/fixtures/child-process.test.ts` の `oxlint-disable-next-line` が確かめます。規則が外れると、使われない disable のコメントで `vp check` が失敗します。
- Vitest の `setupFiles` (`src/test/setup.ts`) が、git が hook の中で設定する `GIT_DIR`、`GIT_INDEX_FILE` など (`git rev-parse --local-env-vars`) を消し、ユーザーとシステムの git の設定を読まないようにし、`GIT_ALLOW_PROTOCOL=file` でネットワーク越しの git を禁じます。
- `src/test/isolation.test.ts` (`unit`) は `test-isolation` の target で、pre-commit では流さず、隔離の仕組み (`tools/scripts/src/test/**`、`tools/scripts/vite.config.ts`) を変えたときだけ CI と pre-push が流します。流す条件は `test-isolation` の `inputs` が決め、`src/configs/test-isolation-inputs.tools.test.ts` が、本物の Nx で「隔離の仕組みを変えたら選ばれ、ほかのファイルなら選ばれない」ことを確かめます。`unit` を hook の変数の下でもう一度流す分だけ長く (約 50 秒)、毎回流すほどの価値はないからです。新しいテストが隔離を破っても、仕組みを触らない PR では流れないので見つかりません。その穴は、`gitIn` の拒否、`setup.ts`、lint の規則、main への直接 push を止める ruleset が守ります。pre-commit で流さないのは、流しても、同じ hook の中の `unit` が実リポジトリを変えるのは止められず、報告するだけだからです。止めるのは `gitIn` の拒否と `setup.ts` と lint の規則で、このテストは、それをすり抜けたテストが merge される前に知らせます。decoy のリポジトリを指す hook の変数を設定し、decoy を作業ディレクトリにして `unit` の project のテストを子プロセスで動かし、decoy が変わらないことを確かめます。`gitIn` を通さずに作業ディレクトリのリポジトリや hook の変数が指すリポジトリを変えるテストを足すと、このテストが失敗します。fingerprint を取るのは decoy だけなので、動的な `import()` で `node:child_process` を読み込み、`git -C <このリポジトリの絶対パス>` のように別のリポジトリをパスで指定するテストは見つかりません。この場合は、静的な import を止める `no-restricted-imports` と、レビューで守ります ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md) の「隔離」)。
