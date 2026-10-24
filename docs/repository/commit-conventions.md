---
type: Convention
title: コミットと PR の規約
description: Conventional Commits の type と scope、PR タイトルと本文の書き方、破壊的変更の示し方を定める規約。コミットメッセージや PR を書くときに読む。
tags: [repository, convention, conventional-commits, pull-request]
---

# コミットと PR の規約

コミットメッセージと PR タイトルは Conventional Commits で書き、commit-msg hook と CI の commitlint で検証します。
PR は squash merge だけを使い、破壊的変更は PR タイトルの `!` で示します ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))。

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) に従います。

```text
<type>(<scope>): <subject>
```

- **type** (必須): `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- **scope** (任意): 変更した場所を1つ書きます。複数の場所にまたがる場合は省略します。次の中から選びます (`commitlint.config.ts` の `scope-enum` で検証します)。
  - Nx のプロジェクト名: `api`、`web` (プロジェクトを足すと自動で増えます)
  - `docs`: `docs/` の文書
  - `ci`: `.github/` の workflow と ruleset
  - `hooks`: Git hook (`lefthook.yml`、`scripts/`) と Kiro の hook (`.kiro/hooks/`)
  - `deps`: 依存の追加と更新 (`package.json`、`pnpm-workspace.yaml` の catalog、lockfile)
- **subject**: 日本語でも英語でも構いません。先頭は大文字の英単語にしません (`subject-case`)。ファイル名や略語 (`CODEOWNERS`、`README`、`API`) で始めると拒否されるので、日本語の語を前に置きます (例: `docs: コミュニティの文書 (CODEOWNERS …) を置く`)。
- **本文**: 1行は 100 文字以内にします (`body-max-line-length`)。
- 破壊的変更は `feat(api)!: ...` のように `!` を付けます。

例:

```text
feat(api): ユーザー登録 API を追加
fix(web): トップページの表示崩れを修正
ci: secret scan のタイムアウトを延長
docs(docs): リリース手順を書き直す
chore(deps): hono を 4.14 に上げる
```

`feat` と `fix` はリリース時のバージョン決定と CHANGELOG に使われます ([リリース](release.md))。

## PR

- PR タイトルがそのまま main のコミットメッセージになるので、PR タイトルもコミットメッセージと同じ規約で書きます。CI で検証します。
- 本文は `.github/pull_request_template.md` のテンプレートが自動で入ります。本文は squash コミットの本文にもなるので、使わない節と `<!-- -->` のコメントは消してから出します。
- 破壊的変更は本文ではなく、PR タイトルの `!` で示します。本文は commitlint で検証されないためです。
