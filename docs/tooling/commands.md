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
packages/  共有パッケージ (今はなし)
tools/
  scripts/ hook と CI から呼ぶ TypeScript の検査 (Nx の project scripts。ADR 0024)
scripts/   hook と CI から呼ぶシェルスクリプト (tools/scripts に移している途中)
docs/      ドキュメント (入口は docs/index.md)
```

## コマンド

| やりたいこと                                                                                                     | コマンド                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| api の開発サーバー (<http://localhost:3000>)                                                                     | `pnpm exec nx dev api`                                                                                                                              |
| web の開発サーバー (<http://localhost:5173>)                                                                     | `pnpm exec nx dev web`                                                                                                                              |
| 全プロジェクトの lint、format、型チェック                                                                        | `pnpm check`                                                                                                                                        |
| プロジェクトの外にあるファイルの同じ検査                                                                         | `pnpm check:root`                                                                                                                                   |
| 全プロジェクトのテスト                                                                                           | `pnpm test`                                                                                                                                         |
| 全プロジェクトの build                                                                                           | `pnpm build`                                                                                                                                        |
| 変更の影響を受けるプロジェクトだけ実行                                                                           | `pnpm exec nx affected -t check test build mutation`                                                                                                |
| format と lint の自動修正                                                                                        | `pnpm exec vp check --fix`                                                                                                                          |
| Markdown の検査                                                                                                  | `pnpm lint:md`                                                                                                                                      |
| 重複コードの検査 (`apps/`、`packages/`)                                                                          | `pnpm lint:dup`。閾値は [ADR 0014](../adr/0014-jscpd-duplication-threshold.md)                                                                      |
| 未使用のファイル、export、依存の検査 (workspace の全プロジェクトとルート)                                        | `pnpm lint:unused`。例外は `knip.jsonc` ([ADR 0017](../adr/0017-knip-unused-code.md))                                                               |
| シェルスクリプトの検査                                                                                           | `scripts/shellcheck.sh`                                                                                                                             |
| GitHub Actions の workflow の検査 (jactionlint、zizmor)                                                          | `scripts/lint-workflows.sh`                                                                                                                         |
| `renovate.jsonc` の検査と、Renovate が出す PR の確認                                                             | `scripts/renovate.sh validate`、`scripts/renovate.sh preview` ([Renovate](renovate.md))                                                             |
| docs の検査 (OKF、リンク切れ、見出しへのリンク、リンクの `.md`、孤立文書、index の「いつ読むか」、250行超の警告) | `scripts/docs-check.sh`。`staged` を付けると、取り込んだガイドラインの変更に `about.md` の記録があるかも見る (pre-commit)                           |
| スクリプトと Kiro の hook のテスト                                                                               | TypeScript: `pnpm exec nx test scripts`。sh: `sh scripts/test/run.sh` ([CI](ci.md#スクリプトのテスト))                                              |
| `tools/scripts` の純粋な関数の mutation test (Stryker)                                                           | `pnpm exec nx mutation scripts`                                                                                                                     |
| `tools/scripts` の、本物の道具と設定を使うテスト (mise の道具が要る)                                             | `pnpm exec nx test-tools scripts`                                                                                                                   |
| 次に使える ADR の番号 (open な PR が使っている番号も除く)                                                        | `node tools/scripts/src/checks/check-adr-number/cli.ts`                                                                                             |
| worktree を作る (どこから実行しても `<main の作業ツリー>-worktrees/<ブランチ名>` に作る)                         | `scripts/worktree.sh add <ブランチ名>`。場所だけを知るときは `path`                                                                                 |
| 判断が絡む変更に ADR がないかの確認 (警告だけ)                                                                   | `node tools/scripts/src/checks/adr-check/cli.ts`。要らない変更は `ADR_ACK=1` で抑える ([ADR 0016](../adr/0016-adr-check-warns-without-blocking.md)) |
| 依存の追加 (例: api)                                                                                             | `pnpm --filter @agent-software-factory/api add <pkg>`                                                                                               |

## 補足

- 一回限りの実行は `pnpm dlx <pkg>` を使います。リポジトリの中で `npx` を実行すると、`devEngines.packageManager` が pnpm なので `EBADDEVENGINES` で失敗します。
- 依存のバージョンは `pnpm-workspace.yaml` の `catalog` で一元管理します (`catalogMode: prefer`)。`pnpm add` すると自動で catalog に追加されます。
- `pnpm add` で、公開から 1 日 (pnpm の `minimumReleaseAge` の既定値、1440 分) 経っていない版を指定すると、pnpm は何も表示せずに `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` にその版を書き足します。足されたら、1 日以上前に公開された版を指定し直します。
- registry のパッケージの情報 (版、公開日、依存) は `pnpm view <pkg>` で調べます。このリポジトリでは、`npm view` は `package.json` の `devEngines` (pnpm を指定) で `EBADDEVENGINES` になります。
- `apps/web/src/routeTree.gen.ts` は TanStack Router が生成するファイルです。手で編集せず、生成された差分を commit します。CI は build の後に差分が残ると失敗します。
- `vp check` と、それを呼ぶ Nx の target のエラーには ANSI の色のコードが入るので、出力を grep するときは `FORCE_COLOR=0` を付けます (例: `FORCE_COLOR=0 pnpm exec nx run api:check`)。`NO_COLOR=1` では色が消えません。
- `vp check` にファイルを渡すときは `--no-error-on-unmatched-pattern` を付けます。渡したファイルに lint の対象 (`.ts` など) が1つもないと、`.md` や `.json` だけでも `No files found to lint` で失敗するためです。lefthook と `scripts/check-root-files.sh` は付けています。
