---
type: Reference
title: 外部ドキュメントの読み方
description: AWS と Hono の一次情報を、ナビゲーションの少ない Markdown で読むための URL の早見表。AWS や Hono のドキュメントを web で調べるときに読む。
tags: [tooling, reference, aws, hono, web-fetch]
---

# 外部ドキュメントの読み方

AWS と Hono のドキュメントは、HTML のページを開かずに Markdown の版を読みます。
HTML のページは大半がナビゲーションで、`web_fetch` の 8000 文字に本文が収まりません。

| 対象                | 読む URL                                                               | 備考                                                                                                          |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| AWS のドキュメント  | `https://docs.aws.amazon.com/<path>.md` (`.html` を `.md` に変える)    | 製品ページ (`aws.amazon.com/<service>/...`) より先に docs.aws.amazon.com を探す                               |
| Hono のドキュメント | `https://raw.githubusercontent.com/honojs/website/main/docs/<path>.md` | `<path>` は hono.dev の URL の `/docs/` より後 (例: `getting-started/aws-lambda`)。hono.dev に `.md` 版はない |
| Hono の全体         | `https://hono.dev/llms.txt`                                            | 目次だけ。`llms-full.txt` は約 400 KB あり、一度に読むには大きすぎる                                          |
