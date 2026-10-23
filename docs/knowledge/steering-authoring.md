---
type: Convention
title: steering の書き方
description: .kiro/steering/ のファイルに何を書くかと、1 行の形式を定める規約。steering を追加、変更するときに読む。
tags: [knowledge, convention, steering]
---

# steering の書き方

`.kiro/steering/` のファイルは毎回のセッションで読み込まれるので、`docs/` の文書へのポインタだけを書きます。
内容は `docs/` に書き、steering には「いつ」「どの文書を」読むかを 1 行で書きます ([役割分担](knowledge-architecture.md))。

## 形式

- 1 つのファイルに 1 つの領域を書きます。ファイル名は領域の名前にします (例: `external-docs.md`)。
- 本文は H1 と、次の形式の行だけにします。

  ```markdown
  <いつ読むか>は、`docs/<領域>/<文書>.md` を読む。
  ```

- 「いつ読むか」は、作業や状況を先頭に書きます (例:「AWS や Hono のドキュメントを web で調べるとき」)。
- 1 つの行には 1 つの状況だけを書きます。同じ状況の言い換えは足しません。
