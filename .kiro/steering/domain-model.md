---
inclusion: fileMatch
fileMatchPattern: ["packages/*/src/domain/**", "packages/*/src/application/**"]
name: domain-model
description: モジュールの domain と application のコードを作成または編集するときに、どの docs の規約を読むかを示す。
---

# ドメインモデル

`domain` と `application` のコードを作成、編集するときは、`docs/domain-model/index.md` を読む。状態と値の型、失敗の表し方、Effect の書き方、識別子の対応表の文書への入口がある。

`application` で Effect の書き方を調べるときは、入れた版の `node_modules/effect/AGENTS.md` と `ai-docs/src/` を読む (`docs/tooling/external-docs.md`)。そこには使わないと決めた機能 (`Schema` など) の例も入っているので、使う範囲は `docs/domain-model/application-effect.md` に従う。
