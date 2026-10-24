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

| 役割                                  | ツール                                               |
| ------------------------------------- | ---------------------------------------------------- |
| モノレポ、タスクの実行と cache        | Nx 24                                                |
| パッケージマネージャ                  | pnpm 12.15.0 (`package.json` の `devEngines` で固定) |
| Node.js                               | 26 (`.node-version` で固定)                          |
| build、test、lint、format、型チェック | Vite+ (`vp`)                                         |
| Git hook                              | lefthook                                             |
| コミットメッセージの検証              | commitlint (Conventional Commits)                    |
| 秘密情報の検出                        | betterleaks (`mise.toml` と `mise.lock` で固定)      |
| Markdown の検査                       | markdownlint-cli2                                    |
| docs の管理と検査                     | IWE (OKF v0.2 バンドル)                              |

```text
apps/
  api/   Hono (Node.js)。GET /health
  web/   React + TanStack Router
packages/  共有パッケージ (今はなし)
scripts/   hook と CI から呼ぶシェルスクリプト
docs/      ドキュメント (入口は docs/index.md)
```

## コマンド

| やりたいこと                                                                                     | コマンド                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| api の開発サーバー (<http://localhost:3000>)                                                     | `pnpm exec nx dev api`                           |
| web の開発サーバー (<http://localhost:5173>)                                                     | `pnpm exec nx dev web`                           |
| 全プロジェクトの lint、format、型チェック                                                        | `pnpm check`                                     |
| プロジェクトの外にあるファイルの同じ検査                                                         | `pnpm check:root`                                |
| 全プロジェクトのテスト                                                                           | `pnpm test`                                      |
| 全プロジェクトの build                                                                           | `pnpm build`                                     |
| 変更の影響を受けるプロジェクトだけ実行                                                           | `pnpm exec nx affected -t check test build`      |
| format と lint の自動修正                                                                        | `pnpm exec vp check --fix`                       |
| Markdown の検査                                                                                  | `pnpm lint:md`                                   |
| シェルスクリプトの検査                                                                           | `scripts/shellcheck.sh`                          |
| docs の検査 (OKF、リンク切れ、見出しへのリンク、孤立文書、index の「いつ読むか」、250行超の警告) | `scripts/docs-check.sh`                          |
| スクリプトと Kiro の hook のテスト                                                               | `sh scripts/test/run.sh`                         |
| 依存の追加 (例: api)                                                                             | `pnpm --filter @hono-nx-vite-plus/api add <pkg>` |

## 補足

- 依存のバージョンは `pnpm-workspace.yaml` の `catalog` で一元管理します (`catalogMode: prefer`)。`pnpm add` すると自動で catalog に追加されます。
- `apps/web/src/routeTree.gen.ts` は TanStack Router が生成するファイルです。手で編集せず、生成された差分を commit します。CI は build の後に差分が残ると失敗します。
- `vp check` と、それを呼ぶ Nx の target のエラーには ANSI の色のコードが入るので、出力を grep するときは `FORCE_COLOR=0` を付けます (例: `FORCE_COLOR=0 pnpm exec nx run api:check`)。`NO_COLOR=1` では色が消えません。
- `vp check` にファイルを渡すときは `--no-error-on-unmatched-pattern` を付けます。渡したファイルに lint の対象 (`.ts` など) が1つもないと、`.md` や `.json` だけでも `No files found to lint` で失敗するためです。lefthook と `scripts/check-root-files.sh` は付けています。
