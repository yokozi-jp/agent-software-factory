---
inclusion: fileMatch
fileMatchPattern: ["packages/*/src/domain/**", "packages/*/src/application/**"]
name: domain-model
description: モジュールの domain と application のコードを作成または編集するときに、どの docs の規約を読むかを示す。
---

# ドメインモデル

`domain` と `application` のコードを作成、編集するときは、`docs/domain-model/index.md` を読む。状態と値の型、失敗の表し方、Effect の書き方、識別子の対応表の文書への入口がある。

`application` では、Effect の書き方の一次情報として、入れた版の `node_modules/effect/AGENTS.md` と `ai-docs/src/` も読む (`docs/tooling/external-docs.md`)。ただし、そこには使わないと決めた機能 (`Schema` など) の例も入っている。使う範囲は ADR 0028 と `docs/domain-model/application-effect.md` に従う。19 KB あるので、常には読み込まない。
