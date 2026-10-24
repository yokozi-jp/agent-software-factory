---
type: Convention
title: docs の書き方
description: docs/ の文書を作成、編集、移動、分割するときの配置、index.md の形式、frontmatter と type の語彙、IWE の使い方、検査を定める規約。docs の文書を変える前に読む。
tags: [knowledge, convention, documentation, iwe, okf]
---

# docs の書き方

`docs/` は OKF v0.2 バンドルで、IWE で管理します ([ADR 0005](../adr/0005-manage-docs-with-iwe-okf.md))。
新しい文書は `iwe_create` で作り、既存の文書はファイルを直接編集し、移動は `git mv` で行います ([ADR 0006](../adr/0006-no-iwe-rewrites.md))。
文書は領域の `index.md` からリンクし、変更後は `scripts/docs-check.sh` と `pnpm lint:md` を実行します。

## 領域と index.md

- 文書は `docs/<領域>/` に置き、各領域に `index.md` を置きます。`docs/index.md` から各領域の `index.md` へリンクします。
- `index.md` は OKF の予約ファイルで、frontmatter を持ちません。`docs/index.md` だけは `okf_version` を持ちます。
- `index.md` には H1 と、次の形式の箇条書きだけを書きます。「いつ読むか」には、その文書を開くべき作業や状況を書きます。各リンク行には全角コロン `：` に続けて「いつ読むか」を必ず書きます (空や半角コロンは `scripts/docs-check.sh` が失敗させます)。開く前に要否を判断できるようにして、docs 全体を読ませないためです。

  ```markdown
  - [タイトル](file.md)：いつ読むか
  ```

- どの `index.md` からもリンクされない文書 (孤立文書) を残しません。

## 文書の構造

- 1ファイルに1つの責務を書きます。「この文書を読めば何が決まるか」を一つの問いで言える単位にします。
- 250行は責務が混ざっていないかを見直す目安です。超えただけでは分割しません。`scripts/docs-check.sh` が250行超を警告しますが、検査は失敗させません。行数を割るための分割は、関連する内容が複数ファイルに散って読む量が増えるので避け、分けるときは責務で分けます。
- 冒頭の H1 の直後に、要点を1〜4行で書きます。
- 規約文書には今のルールと検査方法を書き、理由は ADR にリンクします。

## frontmatter

`index.md` 以外の文書には、`type`、`title`、`description`、`tags` を書きます。`docs/.iwe/schemas/okf.yaml` が検査します。

- `description`: 何を定める文書かと、いつ読むかを書きます。
- `type`: 本文の主な責務に合わせて、次から選びます。
  - **Convention**: 守るべき規約
  - **Architecture**: 構造と依存の説明
  - **Runbook**: 手順
  - **Reference**: コマンドや設定の早見表
  - **Domain**: 業務知識
  - **ADR**: Architecture Decision Record

## IWE の使い方

| 操作                 | 方法                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 新しい文書を作る     | `iwe_create` (MCP) または `docs/` で `pnpm exec iwe create <key> -c -` を実行して作り、すぐに `pnpm exec vp fmt <file>` を実行する |
| 既存の文書を編集する | ファイルを直接編集する                                                                                                             |
| 文書を移動する       | `git mv` で移し、リンク元の相対パスを手で直す                                                                                      |
| 検索、リンクの追跡   | `iwe_find`、`iwe_retrieve`、`iwe_tree` (MCP)、または `pnpm exec iwe find` など                                                     |
| 使わない操作         | `normalize`、`rename`、`update`、`extract`、`inline`、`squash`、`attach`、`delete`                                                 |

`iwe create` は content mode でも書式を少し変えます (iwe 0.29.0 で、コードブロックの言語の前の空白、表の整列、リストの項目の間の空行)。
`vp fmt` で前の2つは戻りますが、リストの空行は残ることがあるので、作成後に差分を確認します。
`iwe create` は HTML コメント (`<!-- ... -->`) も消します。続けて2つ置いた注記 (`> [!NOTE]`) を分けるコメントなどを残したい文書は、作成した後にファイルを直接書き直します。
`iwe create` は、カレントディレクトリにある `.iwe/` の設定で動きます。`docs/` の外 (リポジトリのルートなど) で実行すると、`docs/.iwe/` を読まずに、そのディレクトリにファイルを作り、リンクから `.md` を外し、行末の改行を空白に変えました (iwe 0.29.0)。`docs/` に移ってから実行します。

使わない操作は、MCP では `.kiro/settings/mcp.json` の `disabledTools` で無効にしています。
CLI の `iwe normalize` は、Kiro の hook (`.kiro/hooks/block-iwe-normalize.sh`) が拒否します。

## ADR

ADR は `docs/adr/` に `NNNN-slug.md` の連番で置き、`domain-modeling` skill の ADR-FORMAT.md の形式で書きます。frontmatter の `type` は `ADR` です。
追加したら `docs/adr/index.md` に1行加えます。

### ADR を書くかどうか

次の3つがそろうときだけ ADR を書きます (`domain-modeling` skill の ADR-FORMAT.md の基準です)。

1. 戻しにくい: 後で考えを変えるときの費用が大きい
2. 文脈なしには意外: 後から読んだ人が「なぜこうしたのか」と思う
3. 本当の trade-off の結果: ほかの選択肢があり、理由があって選んだ

戻しやすい決定は、戻せばよいので書きません。意外でなければ、疑問を持つ人がいません。選択肢がなければ、「当たり前のことをした」以上に残すことがありません。
書く価値があるのは、構成の形、ロックインを伴う技術の選択、意図して常識から外れた選択、コードからは見えない制約、理由が自明でない却下した案です。

依存、ツールの設定、workflow、ruleset、Kiro の hook や設定を変えたのに ADR が増えていないと、`scripts/adr-check.sh` が警告します ([ADR 0016](../adr/0016-adr-check-warns-without-blocking.md))。警告が出たら、この3つに当てはめて判断し、要らなければ `ADR_ACK=1` で抑えます。

## 検査

```sh
scripts/docs-check.sh   # OKF のスキーマ、docs/ 内のリンク切れと見出しへのリンク、孤立文書、index の「いつ読むか」、取り込んだガイドラインの公開サイトへのリンク、250行超の警告
pnpm lint:md            # markdownlint-cli2
```

どちらも pre-commit hook と CI で実行します。pre-commit hook は `scripts/docs-check.sh staged` を実行し、取り込んだガイドライン (`about.md` の `sources` が arch-guidelines を挙げる領域) の文書をステージしたのに、その領域の `about.md` をステージしていなければ失敗させます。変えたことを「原文からの変更点」に書くためです。`docs/` の外へのリンク (`../` で始まるもの) は、リンク切れの検査の対象外です。
