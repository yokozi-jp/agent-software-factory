---
type: Reference
title: 外部ドキュメントの読み方
description: AWS、Hono、Vite+、Nx、mise の一次情報を、ナビゲーションの少ない Markdown やローカルのファイルで読むための早見表。これらのドキュメントや設定項目を調べるときに読む。
tags: [tooling, reference, aws, hono, vite-plus, nx, mise, web-fetch]
---

# 外部ドキュメントの読み方

AWS と Hono のドキュメントは、HTML のページを開かずに Markdown の版を読みます。
HTML のページは大半がナビゲーションで、`web_fetch` の 8000 文字に本文が収まりません。
Vite+ と Nx は、GitHub の Markdown と、インストールされているパッケージのファイルを読みます。

| 対象                 | 読む URL                                                                       | 備考                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| AWS のドキュメント   | `https://docs.aws.amazon.com/<path>.md` (`.html` を `.md` に変える)            | 製品ページ (`aws.amazon.com/<service>/...`) より先に docs.aws.amazon.com を探す                               |
| Hono のドキュメント  | `https://raw.githubusercontent.com/honojs/website/main/docs/<path>.md`         | `<path>` は hono.dev の URL の `/docs/` より後 (例: `getting-started/aws-lambda`)。hono.dev に `.md` 版はない |
| Hono の全体          | `https://hono.dev/llms.txt`                                                    | 目次だけ。`llms-full.txt` は約 400 KB あり、一度に読むには大きすぎる                                          |
| Vite+ のドキュメント | `https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/docs/<path>.md` | `<path>` は viteplus.dev の URL のパス (例: `guide/monorepo`、`config/run`)                                   |
| Vite+ のテンプレート | `https://github.com/voidzero-dev/vite-plus` の `packages/cli/templates/`       | `vp create vite:monorepo` などが生成する構成。Vite+ の標準の形を確かめるときに読む                            |
| Nx の設定項目        | `node_modules/nx/schemas/nx-schema.json`                                       | `nx.json` の各設定の説明と既定値。インストールされている版のものなので、web の docs より正確                  |
| mise のドキュメント  | `https://raw.githubusercontent.com/jdx/mise/main/docs/<path>.md`               | `<path>` は mise.jdx.dev の URL のパス (例: `dev-tools/mise-lock`)。設定項目と既定値は `settings.toml` にある |
