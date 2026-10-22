---
type: Runbook
title: GitHub リポジトリの設定
description: squash merge だけを許可する設定と、main の必須チェックを、管理者が gh で1回だけ設定する手順。リポジトリを作ったとき、merge の設定や branch protection を変えるときに読む。
tags: [repository, runbook, github, branch-protection]
---

# GitHub リポジトリの設定

管理者が1回だけ実行します。squash merge だけを許可し、main の必須チェックを設定します ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))。

## merge の方式

squash のコミットタイトルを PR タイトル、本文を PR の説明にします。

```sh
gh repo edit yokozi-jp/hono-nx-vite-plus \
  --enable-squash-merge \
  --squash-merge-commit-message pr-title-description \
  --enable-merge-commit=false \
  --enable-rebase-merge=false \
  --delete-branch-on-merge
```

## 必須チェック

main の branch protection (または ruleset) では、次の status check を必須にすることを推奨します。

- `CI / main`
- `Commitlint / commitlint`
- `Secret scan / betterleaks`

[リリース](release.md) の workflow は main に直接 push するので、`github-actions[bot]` の bypass を許可します。
