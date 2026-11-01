---
type: Reference
title: 開発コマンド
description: リポジトリの構成と、開発サーバー、check、test、build、依存の追加、docs の検査など日常的に使うコマンドの早見表。コマンドを探すときに読む。
tags: [tooling, reference, nx, vite-plus, pnpm]
---

# 開発コマンド

コマンドは root から実行します。タスクは Nx が実行し、結果を cache します。
`vp run` は使いません ([ADR 0002](../adr/0002-nx-orchestrates-vite-plus.md))。

## 構成

| 役割                                  | ツール                                          |
| ------------------------------------- | ----------------------------------------------- |
| モノレポ、タスクの実行と cache        | Nx 24                                           |
| パッケージマネージャ                  | pnpm (`package.json` の `devEngines` で固定)    |
| Node.js                               | `.node-version` で固定                          |
| build、test、lint、format、型チェック | Vite+ (`vp`)                                    |
| Git hook                              | lefthook                                        |
| コミットメッセージの検証              | commitlint (Conventional Commits)               |
| 秘密情報の検出                        | betterleaks (`mise.toml` と `mise.lock` で固定) |
| Markdown の検査                       | markdownlint-cli2                               |
| 重複コードの検査                      | jscpd (`.jscpd.json`)                           |
| 未使用のファイル、export、依存の検査  | Knip (`knip.jsonc`)                             |
| docs の管理と検査                     | IWE (OKF v0.2 バンドル)                         |

```text
apps/
  api/   Hono (Node.js)。GET /health
  web/   React + TanStack Router
packages/  サンプル機能のモジュール (claim、approval、closing) と共有コード (shared-kernel)。ADR 0026
  <module>/src/  index.ts (公開 API) と層 (domain/、application/、infrastructure/、http/)
tools/
  lint-plugins/ 自作の Oxlint の JS plugin とそのテスト (Nx の project lint-plugins。ADR 0030)
  scripts/ hook と CI から呼ぶ検査 (Nx の project scripts。ADR 0024)
    src/     TypeScript の検査 (checks/)、Kiro の hook (hooks/)、工場の成果の指標の集計 (metrics/)、Kiro のセッションの記録から agent の規則の結果を読む道具 (agent-probe/)、sh のラッパーのテスト (sh/)、設定のテスト (configs/)
    sh/      CLI を呼ぶだけの sh のラッパー
docs/      ドキュメント (入口は docs/index.md)
```

## コマンド

| やりたいこと                                                                                                                                      | コマンド                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| api の開発サーバー (<http://localhost:3000>)                                                                                                      | `pnpm exec nx dev api`                                                                                                                              |
| api の認証つきの開発サーバー (<http://localhost:3000>。[手順](local-api.md))                                                                      | `pnpm --filter @agent-software-factory/api dev:auth`                                                                                                |
| ローカルの IdP (<http://127.0.0.1:9000>。[手順](local-api.md))                                                                                    | `pnpm --filter @agent-software-factory/api dev:idp`                                                                                                 |
| web の開発サーバー (<http://localhost:5173>)                                                                                                      | `pnpm exec nx dev web`                                                                                                                              |
| API の route を変えたあと、OpenAPI の spec (`apps/api/openapi.json`) を書き直す ([ADR 0047](../adr/0047-api-contract-with-zod-openapi-and-hc.md)) | `pnpm exec nx openapi api`                                                                                                                          |
| API の契約 (`apps/api/openapi.json`) の lint (Spectral。[ADR 0047](../adr/0047-api-contract-with-zod-openapi-and-hc.md))                          | `pnpm exec nx contract-lint api`                                                                                                                    |
| API の契約の、`origin/main` の spec に対する破壊的変更の検査 (oasdiff。CI は PR だけで実行)                                                       | `pnpm exec nx contract-breaking api`                                                                                                                |
| 全プロジェクトの lint、format、型チェック                                                                                                         | `pnpm check`                                                                                                                                        |
| プロジェクトの外にあるファイルの同じ検査                                                                                                          | `pnpm check:root`                                                                                                                                   |
| モジュールの DB の型を migration から生成し直す ([PostgreSQL のクライアント管理](../db/postgresql-client.md))                                     | `pnpm exec nx db-types db`。確かめるだけなら `pnpm exec nx db-types-check db`                                                                       |
| Effect の検査 (実行し忘れ、Effect 3、unstable の API。[Effect の検査](effect-lint.md))                                                            | `pnpm exec nx run-many -t lint-effect`                                                                                                              |
| 文言のキーの検査 (キーの欠落、使われないキー。[ADR 0044](../adr/0044-i18next-for-texts.md))                                                       | `pnpm exec nx run web:i18n-keys`                                                                                                                    |
| 作業の途中のテスト (変更の影響を受けるプロジェクトだけ。pre-push と同じ範囲。[テストの流し方](#テストの流し方))                                   | `pnpm exec nx affected -t test --base=origin/main`                                                                                                  |
| 1 つのプロジェクトのテスト (プロジェクトの名前は `pnpm exec nx show projects --with-target test`)                                                 | `pnpm exec nx test <project>`                                                                                                                       |
| 全プロジェクトのテスト (全部を確かめたいとき)                                                                                                     | `pnpm test`                                                                                                                                         |
| 各 project の coverage の記録を合わせた、ファイルごとの下限の検査 (`test` の後に流す。[CI](ci.md#合わせた検査))                                   | `node tools/scripts/src/checks/merged-coverage/cli.ts`                                                                                              |
| 全プロジェクトの build                                                                                                                            | `pnpm build`                                                                                                                                        |
| 変更の影響を受けるプロジェクトだけ実行                                                                                                            | `pnpm exec nx affected -t check test build`                                                                                                         |
| format と lint の自動修正                                                                                                                         | `pnpm exec vp check --fix`                                                                                                                          |
| Markdown の検査                                                                                                                                   | `pnpm lint:md`                                                                                                                                      |
| 重複コードの検査 (`apps/`、`packages/`)                                                                                                           | `pnpm lint:dup`。閾値は [ADR 0014](../adr/0014-jscpd-duplication-threshold.md)                                                                      |
| 未使用のファイル、export、依存の検査 (workspace の全プロジェクトとルート)                                                                         | `pnpm lint:unused`。例外は `knip.jsonc` ([ADR 0017](../adr/0017-knip-unused-code.md))                                                               |
| シェルスクリプトの検査                                                                                                                            | `tools/scripts/sh/shellcheck.sh`                                                                                                                    |
| GitHub Actions の workflow の検査 (jactionlint、zizmor)                                                                                           | `tools/scripts/sh/lint-workflows.sh`                                                                                                                |
| `renovate.jsonc` の検査と、Renovate が出す PR の確認                                                                                              | `tools/scripts/sh/renovate.sh validate`、`tools/scripts/sh/renovate.sh preview` ([Renovate](renovate.md))                                           |
| docs の検査 (OKF、リンク切れ、見出しへのリンク、リンクの `.md`、孤立文書、index の「いつ読むか」、250行超の警告)                                  | `node tools/scripts/src/checks/docs-check/cli.ts`。`staged` を付けると、取り込んだガイドラインの変更に `about.md` の記録があるかも見る (pre-commit) |
| スクリプトと Kiro の hook のテスト (`unit`。pre-commit と CI が使う)                                                                              | `pnpm exec nx test scripts` ([CI](ci.md#スクリプトのテスト))                                                                                        |
| スクリプトのテストの隔離 (隔離の仕組みを変えたときに、CI と pre-push が使う)                                                                      | `pnpm exec nx test-isolation scripts` ([CI](ci.md#スクリプトのテスト))                                                                              |
| `tools/scripts` の純粋な関数の mutation test (Stryker)                                                                                            | `pnpm exec nx mutation scripts`                                                                                                                     |
| `tools/scripts` の、本物の道具と設定を使うテスト (mise の道具が要るものがある)                                                                    | `pnpm exec nx test-tools scripts`                                                                                                                   |
| 次に使える ADR の番号 (open な PR が使っている番号も除く)                                                                                         | `node tools/scripts/src/checks/check-adr-number/cli.ts`                                                                                             |
| worktree を作る (どこから実行しても `<main の作業ツリー>-worktrees/<ブランチ名>` に作る)                                                          | `tools/scripts/sh/worktree.sh add <ブランチ名>`。場所だけを知るときは `path`                                                                        |
| 判断が絡む変更に ADR がないかの確認 (警告だけ)                                                                                                    | `node tools/scripts/src/checks/adr-check/cli.ts`。要らない変更は `ADR_ACK=1` で抑える ([ADR 0016](../adr/0016-adr-check-warns-without-blocking.md)) |
| テストファイルの削除とテストケースの数の減少の確認 (警告だけ)                                                                                     | `node tools/scripts/src/checks/test-weakening/cli.ts`。意図した変更は `TESTS_ACK=1` で抑える ([CI](ci.md#ciyml-の検証))                             |
| 工場の成果の指標の集計 (期間か、境目の PR の前後)                                                                                                 | `node tools/scripts/src/metrics/cli.ts --since <YYYY-MM-DD>` ([工場の成果の指標](../agents/factory-metrics.md))                                     |
| agent の規則が各 tool の呼び出しにどう働いたかの確認 (最新のセッション)                                                                           | `node tools/scripts/src/agent-probe/cli.ts <workspace の絶対パス>` ([エージェントの権限](agent-permissions.md#規則を変えたときの手元の確認))        |
| 依存の追加 (例: api)                                                                                                                              | `pnpm --filter @agent-software-factory/api add <pkg>`                                                                                               |

## テストの流し方

同じマシンで複数のセッションがテストを流すと CPU が足りなくなるので、作業の途中は変更に関係するテストだけを流します。

1. 変えたファイルのテストは、ファイルを渡して流します (例: `pnpm --filter @agent-software-factory/api exec vp test run src/app.test.ts`)。Nx を通らないので cache されません。
2. まとまったところで `pnpm exec nx affected -t test --base=origin/main` を流します。`--base` だけを渡すと、`nx affected` は base からの commit に加えて、commit していない変更と untracked のファイルも数えます (`nx affected --help`)。base に `origin/main` を渡すのは、worktree の手元の `main` が origin/main より古いと、取り込み済みの変更まで affected に数えるためです (`nx.json` の `defaultBase` は `main`)。
3. `pnpm test` (`nx run-many -t test`) は、全部を確かめたいときに流します。変わっていないプロジェクトは cache から再生します。
4. 各 project の記録を合わせた coverage の検査は、`pnpm exec nx affected -t test --base=origin/main` (または `pnpm test`) の後に `node tools/scripts/src/checks/merged-coverage/cli.ts` で流します。`coverage/coverage-final.json` を書いた project のファイルを、ファイルごとに lines と branches が 90% あるか確かめます ([CI](ci.md#合わせた検査))。CI の `nx` の job は、`nx affected -t check test build` の後にこれを流します。pre-push には入れません。

`test` の target は `cache: true` です (`nx.json` の `targetDefaults`)。Nx は cache を `~/.nx/<id>/cache` に置き、main の作業ツリーと全ての worktree で共有するので、入力が同じなら別の worktree で流した結果も再生します ([Change Cache Location](https://nx.dev/docs/guides/tasks--caching/change-cache-location))。再生した target には `[existing outputs match the cache, left as is]` と出ます。

- `--skip-nx-cache` は、cache の結果を疑うときだけ付けます。作業の確認に付けると、変えていないプロジェクトのテストまで流し直します。
- プロジェクトのディレクトリで `vp test run` や `pnpm test` を引数なしで流すと、Nx を通らないので、そのプロジェクトのテストを毎回全部流します。
- 2026-10-31 に、全ての `test` の target を `--skip-nx-cache` で流し (3 分 56 秒。最長は `db:test` の 3 分 17 秒)、続けてもう一度流すと、11 の target の全部が cache から再生されました (38 ms)。テストは入力のファイルを書き換えません。例外は、coverage が上がって `apps/api/vite.config.ts` などの下限が書き換わったときで、次の 1 回は cache に当たりません。

## 補足

- api と db の test は Docker が要ります (`packages/db/test/global-setup.ts` も PostgreSQL のコンテナを起動します)。api の test では、`apps/api/test/global-setup.ts` が PostgreSQL (`packages/db/src/testing/connection.ts` の `postgresImage`) のコンテナを testcontainers で一度だけ起動し、全テストで共有します。IdP は Docker を使わず、テストのプロセスの中で node-oidc-provider を動かします (`apps/api/test/oidc-provider.ts`。複数のセッションが並行しても、IdP は重複せず、起動は 1 秒未満です。[ADR 0022](../adr/0022-better-auth-cookie-bff.md))。GitHub Actions の ubuntu runner は Docker を持つので、CI では何も足しません。
  起動に失敗すると、vitest は `No test files found` と `TypeError: code.charCodeAt is not a function` だけを出します。原因は、その上の `globalSetup (test/global-setup.ts) が失敗した:` の行にあります。PostgreSQL のコンテナの起動の待ちの時間切れなら、ほかのセッションのテストで testcontainers のコンテナが多く動いていないか (`docker ps`、`uptime`) を確かめます。
- api の test は coverage を取り、下限を割ると失敗します ([CI](ci.md#coverage-の下限))。全体の値が上がると `apps/api/vite.config.ts` の下限が書き換わるので、その変更も commit します。`tools/lint-plugins` の test も同じ基準で coverage を取り、`tools/lint-plugins/vite.config.ts` の下限が同じように書き換わります。
- `apps/*/src` のテストの名前 (`describe`、`it`、`test`) は日本語で書きます。実行結果 (`--reporter=verbose`) が、そのまま何を保証しているかの一覧になるためです。日本語を1文字も含まない名前は、`vp check` の自作 Oxlint 規則 `test-title/japanese-title` (`tools/lint-plugins/src/test-title-plugin.ts`) が止めます。"〜すること" の形を勧めます。ツールのテスト (`tools/`) と、lint plugin のテスト (`tools/lint-plugins/`) は対象外です。
- 一回限りの実行は `pnpm dlx <pkg>` を使います。リポジトリの中で `npx` を実行すると、`devEngines.packageManager` が pnpm なので `EBADDEVENGINES` で失敗します。
- 依存のバージョンは `pnpm-workspace.yaml` の `catalog` で一元管理します (`catalogMode: prefer`)。`pnpm add` すると自動で catalog に追加されます。workspace の package (`@agent-software-factory/*`) への依存は `pnpm add` を使わず、`package.json` に `"workspace:*"` を書いて `pnpm install` します。`pnpm add` は catalog に `workspace:*` の行を足し、repo-policy が止めます ([CI](ci.md#ciyml-の検証))。
- `pnpm add` で、公開から 1 日 (pnpm の `minimumReleaseAge` の既定値、1440 分) 経っていない版を指定すると、pnpm は何も表示せずに `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` にその版を書き足します。足されたら、1 日以上前に公開された版を指定し直します。
- registry のパッケージの情報 (版、公開日、依存) は `pnpm view <pkg>` で調べます。このリポジトリでは、`npm view` は `package.json` の `devEngines` (pnpm を指定) で `EBADDEVENGINES` になります。
- web の test は 2 つの Vitest の project です。`unit` は `src/**/*.test.ts`、`storybook` は story の `play` (`packages/ui` の部品の story も含む) で、どちらも Chromium で動きます。片方だけ流すときは `pnpm --filter @agent-software-factory/web exec vp test run --project unit` (または `--project storybook`)。カタログを開くには `pnpm --filter @agent-software-factory/web storybook` (`http://localhost:6006`)。Chromium が無ければ、先に `pnpm --filter @agent-software-factory/web exec playwright install --with-deps chromium` を実行します。
- `apps/web/src/routeTree.gen.ts` は TanStack Router が生成するファイルです。手で編集せず、生成された差分を commit します。CI は build の後に差分が残ると失敗します。
- `vp check` と、それを呼ぶ Nx の target のエラーには ANSI の色のコードが入るので、出力を grep するときは `FORCE_COLOR=0` を付けます (例: `FORCE_COLOR=0 pnpm exec nx run api:check`)。`NO_COLOR=1` では色が消えません。
  色を外した出力では、エラーは行頭の `x`、警告は行頭の `!`、場所は `,-[<ファイル>:<行>:<列>]` の行に出ます (色のある出力では `×` と `╭─[`)。警告も `vp check` を失敗させる (`vite.config.ts` の `denyWarnings: true`) ので、`x` と `!` の両方を拾います (例: `FORCE_COLOR=0 pnpm exec nx run api:check 2>&1 | grep -E '^\s*[x!] |,-\['`)。
- `vp check` にファイルを渡すときは `--no-error-on-unmatched-pattern` を付けます。渡したファイルに lint の対象 (`.ts` など) が1つもないと、`.md` や `.json` だけでも `No files found to lint` で失敗するためです。lefthook と `tools/scripts/sh/check-root-files.sh` は付けています。
