---
type: ADR
title: "ADR 0006: IWE の書き換え操作を使わず、Markdown の書式は oxfmt に任せる"
description: IWE の normalize、rename、update、extract、inline などの書き換え操作を使わず、既存の文書は直接編集し、hook で機械的に拒否するのは normalize だけにする決定。
tags: [adr, documentation, iwe, oxfmt]
---

# ADR 0006: IWE の書き換え操作を使わず、Markdown の書式は oxfmt に任せる

このリポジトリの Markdown の書式は oxfmt (`vp fmt`) が決めています。IWE の `normalize`、`rename`、`update`、`extract`、`inline` は、対象の文書とリンク元の文書を IWE の書式で書き直すので、oxfmt の書式と衝突し、内容と関係のない差分が出ます。そこで IWE は、新しい文書の作成 (`iwe_create`) と、検索、リンクの追跡、検査だけに使います。作成時にリンク切れ、孤立、類似の文書の警告が返るので、作成だけは IWE を通します。既存の文書はファイルを直接編集し、移動は `git mv` で行ってリンクを手で直し、`scripts/docs-check.sh` で確かめます。

## Consequences

- 機械的に止めるのは2か所です。MCP では `.kiro/settings/mcp.json` の `disabledTools` で書き換えるツールを無効にし、CLI では全文書を書き換える `iwe normalize` だけを Kiro の PreToolUse hook で拒否します。CLI の `rename` などは対象の文書が限られるので、規約 (`docs/knowledge/documentation-authoring.md`) とレビューに任せます。
- `iwe create` は content mode でも書式を少し変えます (iwe 0.29.0 の `--help` には内容をそのまま書くとありますが、コードブロックの言語の前に空白を入れ、表を詰めます)。作成後に `vp fmt` を実行して oxfmt の書式に戻します。
- 移動したときのリンク元の修正は手作業になります。直し忘れは docs-check (`tools/scripts/src/checks/docs-check/`) のリンク切れの検査で見つかります。
