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
  - `hooks`: Git hook (`lefthook.yml`、`tools/scripts/sh/`) と Kiro の hook (`.kiro/hooks/`、`tools/scripts/src/hooks/`)
  - `deps`: 依存の追加と更新 (`package.json`、`pnpm-workspace.yaml` の catalog、lockfile)
- **subject**: 日本語でも英語でも構いません。先頭は大文字の英単語にしません (`subject-case`)。ファイル名や略語 (`CODEOWNERS`、`README`、`API`) で始めると拒否されるので、日本語の語を前に置きます (例: `docs: コミュニティの文書 (CODEOWNERS …) を置く`)。
- **本文と footer**: 1行は 100 文字以内にします (`body-max-line-length`、`footer-max-line-length`)。最初の段落以外で、`PR #96` のように行頭の語に続けて `#番号` を書くと、その行は footer として検査されます。どちらの規則でも、長い行は拒否されるので、短い行に折り返します。
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

### commit の前にメッセージを検査する

pre-commit は 2 段で動きます。速い検査 (`quick` の group: repo-policy、`vp check`、docs-check、Knip、jscpd など) を並列に流し、1 つでも失敗したら、遅い検査 (`slow` の group: `scripts-test`、`db-types`、`lint-effect`) を始める前に止めます。遅い検査が 1 分以上かかっても、速い検査の失敗は先に分かります。
commit-msg hook は pre-commit の全部の job が終わった後に動きます。pre-commit は、他のセッションが動いていて負荷が高いと数分かかることがあり、件名の規則 (`subject-case` など) で落ちると、待った時間が無駄になります。`git commit` の前に、メッセージだけを commitlint に通します。

```sh
printf '%s\n' 'feat: 件名' | pnpm exec commitlint   # 終了コード 0 なら通る。本文があるときはその全体を渡す
```

規則を読むときは、この文書を途中で切らずに最後まで読みます。

## PR

- PR タイトルがそのまま main のコミットメッセージになるので、PR タイトルもコミットメッセージと同じ規約で書きます。CI で検証します。
- 本文は `.github/pull_request_template.md` のテンプレートが自動で入ります。本文は squash コミットの本文にもなるので、使わない節と `<!-- -->` のコメントは消してから出します。
- 破壊的変更は本文ではなく、PR タイトルの `!` で示します。本文は commitlint で検証されないためです。
