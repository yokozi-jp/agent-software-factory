---
type: Runbook
title: GitHub リポジトリの設定
description: squash merge だけを許可する設定と、main を ruleset で保護する設定を、管理者が gh で設定する手順と、設定を確かめる方法、緊急時に main を直す方法。リポジトリを作ったとき、merge の設定や main の保護を変えるときに読む。
tags: [repository, runbook, github, ruleset, branch-protection]
---

# GitHub リポジトリの設定

管理者がリポジトリを作ったときに1回だけ実行します。squash merge だけを許可し ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))、main を ruleset で保護します。
main を変えられるのは、必須チェックが通った PR の squash merge だけになります。

## 1. merge の方式

squash のコミットタイトルを PR タイトル、本文を PR の説明にします。

```sh
gh repo edit yokozi-jp/hono-nx-vite-plus \
  --enable-squash-merge \
  --squash-merge-commit-message pr-title-description \
  --enable-merge-commit=false \
  --enable-rebase-merge=false \
  --delete-branch-on-merge
```

## 2. main の保護 (ruleset)

ruleset の定義は `.github/rulesets/protect-main.json` にあります。リポジトリの root で実行します。

```sh
gh api --method POST repos/yokozi-jp/hono-nx-vite-plus/rulesets --input .github/rulesets/protect-main.json
```

既に `protect-main` がある場合は、id を調べて更新します。

```sh
id=$(gh api repos/yokozi-jp/hono-nx-vite-plus/rulesets --jq '.[] | select(.name == "protect-main") | .id')
gh api --method PUT "repos/yokozi-jp/hono-nx-vite-plus/rulesets/$id" --input .github/rulesets/protect-main.json
```

ruleset の内容:

| ルール                   | 効果                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `deletion`               | main を削除できない                                                                                    |
| `non_fast_forward`       | main に force push できない                                                                            |
| `pull_request`           | main への直接の push を拒否し、PR からの squash merge だけを許可する。承認の数は 0 (1人で運用するため) |
| `required_status_checks` | `main` (CI)、`commitlint`、`betterleaks` の3つのチェックが GitHub Actions で通らないと merge できない  |

bypass は、リポジトリの管理者に `pull_request` モードだけを許しています。管理者は、チェックが壊れたときなどに PR の merge で ruleset を飛ばせますが、main への直接の push はできません。
エージェントは利用者の認証情報で push するので、管理者に直接の push を許すと、エージェントの誤った push も通るためです。
ローカルでは、pre-push hook (`scripts/guard-push.sh`) も main への push を拒否します ([Git hook](../tooling/git-hooks.md))。

## 3. 設定を確かめる

```sh
gh api repos/yokozi-jp/hono-nx-vite-plus --jq '{allow_squash_merge, allow_merge_commit, allow_rebase_merge, squash_merge_commit_title, squash_merge_commit_message, delete_branch_on_merge}'
gh api repos/yokozi-jp/hono-nx-vite-plus/rules/branches/main --jq '.[].type'
```

2つ目のコマンドで、`deletion`、`non_fast_forward`、`pull_request`、`required_status_checks` が表示されれば有効です。

## 緊急時に main を直す

main を force push で戻すなど、ruleset に反する操作がどうしても必要なときは、管理者が次の手順で行います。

1. ruleset を一時的に無効にします。

   ```sh
   id=$(gh api repos/yokozi-jp/hono-nx-vite-plus/rulesets --jq '.[] | select(.name == "protect-main") | .id')
   gh api --method PUT "repos/yokozi-jp/hono-nx-vite-plus/rulesets/$id" -f enforcement=disabled
   ```

2. 操作します。ローカルの pre-push hook も拒否するので、`ALLOW_PUSH_TO_MAIN=1` を付けます。force push には `--force-with-lease=main:<今の main の SHA>` を付け、他の人の push を消さないようにします。
3. ruleset を元に戻します (`-f enforcement=active`)。

## 既知の制約: Release workflow

[リリース](release.md) の workflow は `GITHUB_TOKEN` で `chore: release` コミットを main に直接 push します。
`GITHUB_TOKEN` (GitHub Actions) は ruleset の bypass に追加できないので、この ruleset を有効にすると、Release workflow の push は拒否されます。
リリースを始める前に、リリースのコミットを PR にする方式か、bypass に追加できる GitHub App のトークンを使う方式に変える必要があります。
