---
type: Runbook
title: 並行作業と worktree
description: 複数の Kiro セッションや人が同時に作業するときに、git worktree で作業ツリーを分ける手順と片付け方。別のセッションが同じ作業ツリーで動いていると警告されたとき、並行して作業を始めるときに読む。
tags: [tooling, runbook, git, worktree, kiro]
---

# 並行作業と worktree

同じ作業ツリーで2つのセッションが動くと、index とファイルを上書きし合います。
並行して作業するときは、セッションごとに `git worktree` で作業ツリーを分けます。
Kiro の hook (`.kiro/hooks/warn-concurrent-sessions.sh`) は、同じ作業ツリーで別の Kiro セッションが動いていると、セッションの開始時に警告します。後から始まったセッションも見つけられるよう、ファイルの書き込みと shell の前にも確かめ、見つけたら利用者に確認を求めます。

## 警告が出たとき

1. 編集、commit、ブランチの切り替えをする前に、利用者に伝えます。
2. 下の手順で worktree を作り、そこで作業します。

## worktree を作る

worktree は、リポジトリの外の兄弟ディレクトリ `../agent-software-factory-worktrees/<ブランチ名>` に作ります。
リポジトリの中に置くと、Nx、vp check、IWE がその中のファイルまで拾うためです (この置き場所はこのリポジトリで決めたもので、Git の標準ではありません)。

```sh
branch=feat/example
dir=../agent-software-factory-worktrees/$branch
git fetch origin
git worktree add -b "$branch" "$dir" origin/main
cd "$dir"
pnpm install --frozen-lockfile   # node_modules は worktree ごとに必要。Git hook は全ての worktree で共有される
```

作業の手順そのものは `using-git-worktrees` skill に従います。

## 片付ける

PR が merge されたら、worktree とブランチを消します。

```sh
branch=feat/example
gh pr view "$branch" --json state --jq .state   # MERGED であることを確かめる
git worktree remove "../agent-software-factory-worktrees/$branch"
git fetch origin
files=$(git diff --name-only "$(git merge-base "$branch" origin/main)" "$branch")
git diff --quiet "$branch" origin/main -- $files && git branch -D "$branch"
git worktree prune
```

PR は squash merge なので ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))、ブランチの commit は main の履歴に入らず、`git branch -d` は `not fully merged` で必ず止まります。
そこで、ブランチで変えたファイルの中身が main と同じことを確かめてから、`-D` で消します。
merge の後に別の PR が同じファイルを変えていると `git diff --quiet` が失敗し、ブランチは残ります。そのときは差分を読み、ブランチにしかない変更がないことを確かめてから消します。
