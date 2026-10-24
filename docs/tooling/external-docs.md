---
type: Reference
title: 外部ドキュメントの読み方
description: AWS、Hono、Vite+、Nx、mise、pnpm、lefthook、Oxlint、betterleaks、GitHub、RFC、OpenTelemetry、MDN の一次情報を、ナビゲーションの少ない Markdown やローカルのファイルで読むための早見表。これらのドキュメントや設定項目を調べるとき、docs の記述を一次情報で確かめるときに読む。
tags: [tooling, reference, aws, hono, vite-plus, nx, mise, pnpm, github, rfc, web-fetch]
---

# 外部ドキュメントの読み方

AWS と Hono のドキュメントは、HTML のページを開かずに Markdown の版を読みます。
HTML のページは大半がナビゲーションで、`web_fetch` の 8000 文字に本文が収まりません。
Vite+ と Nx は、GitHub の Markdown と、インストールされているパッケージのファイルを読みます。
その他の道具や仕様も、GitHub にある docs の Markdown か、テキストの版を読みます。

| 対象                  | 読む URL                                                                                                            | 備考                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| AWS のドキュメント    | `https://docs.aws.amazon.com/<path>.md` (`.html` を `.md` に変える)                                                 | 製品ページ (`aws.amazon.com/<service>/...`) より先に docs.aws.amazon.com を探す                               |
| Hono のドキュメント   | `https://raw.githubusercontent.com/honojs/website/main/docs/<path>.md`                                              | `<path>` は hono.dev の URL の `/docs/` より後 (例: `getting-started/aws-lambda`)。hono.dev に `.md` 版はない |
| Hono の全体           | `https://hono.dev/llms.txt`                                                                                         | 目次だけ。`llms-full.txt` は約 400 KB あり、一度に読むには大きすぎる                                          |
| Vite+ のドキュメント  | `https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/docs/<path>.md`                                      | `<path>` は viteplus.dev の URL のパス (例: `guide/monorepo`、`config/run`)                                   |
| Vite+ のテンプレート  | `https://github.com/voidzero-dev/vite-plus` の `packages/cli/templates/`                                            | `vp create vite:monorepo` などが生成する構成。Vite+ の標準の形を確かめるときに読む                            |
| Nx の設定項目         | `node_modules/nx/schemas/nx-schema.json`                                                                            | `nx.json` の各設定の説明と既定値。インストールされている版のものなので、web の docs より正確                  |
| mise のドキュメント   | `https://raw.githubusercontent.com/jdx/mise/main/docs/<path>.md`                                                    | `<path>` は mise.jdx.dev の URL のパス (例: `dev-tools/mise-lock`)。設定項目と既定値は `settings.toml` にある |
| pnpm の設定           | `https://raw.githubusercontent.com/pnpm/pnpm.io/main/docs/settings/<区分>.md`                                       | `<区分>` は pnpm.io/settings の節 (例: `dependency-resolution`)。`docs/settings.md` は目次だけ                |
| lefthook              | `https://raw.githubusercontent.com/evilmartians/lefthook/master/docs/configuration/<項目>.md`                       | `<項目>` は設定のキー (例: `glob`)。一覧は `https://lefthook.dev/llms.txt`                                    |
| Oxlint のルール       | `https://raw.githubusercontent.com/oxc-project/website/main/src/docs/guide/usage/linter/rules/<plugin>/<rule>.md`   | 例: `vitest/no-focused-tests`。設定は同じ場所の `config.md`                                                   |
| betterleaks           | `https://raw.githubusercontent.com/betterleaks/betterleaks/main/README.md`                                          | 版ごとの変更は GitHub Releases。設定の形は `.betterleaks.toml`                                                |
| GitHub のドキュメント | `https://docs.github.com/api/article/body?pathname=/en/<path>`                                                      | `<path>` は docs.github.com の URL の `/en/` より後。Markdown の本文だけを返す                                |
| RFC                   | `https://www.rfc-editor.org/rfc/rfc<番号>.txt`                                                                      | 先頭の `Obsoletes:` と `Updates:` で、置き換えられた RFC が分かる                                             |
| OpenTelemetry の規約  | `https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/docs/registry/attributes/<名前空間>.md` | 例: `http`、`db`。属性ごとに Stable や Deprecated と置き換え先が書いてある                                    |
| MDN                   | `https://raw.githubusercontent.com/mdn/content/main/files/en-us/<path>/index.md`                                    | `<path>` は developer.mozilla.org の URL の `/en-US/docs/` より後を小文字にしたもの                           |
