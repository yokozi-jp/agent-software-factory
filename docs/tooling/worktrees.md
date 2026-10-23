---
type: Runbook
title: 並行作業と worktree
description: 複数の Kiro セッションや人が同時に作業するときに、git worktree で作業ツリーを分ける手順と片付け方。別のセッションが同じ作業ツリーで動いていると警告されたとき、並行して作業を始めるときに読む。
tags: [tooling, runbook, git, worktree, kiro]
---

# 並行作業と worktree

同じ作業ツリーで2つのセッションが動くと、index とファイルを上書きし合います。
並行して作業するときは、セッションごとに `git worktree` で作業ツリーを分けます。
Kiro の SessionStart hook (`.kiro/hooks/warn-concurrent-sessions.sh`) は、同じ作業ツリーで別の Kiro セッションが動いていると警告します。

## 警告が出たとき

1. 編集、commit、ブランチの切り替えをする前に、利用者に伝えます。
2. 下の手順で worktree を作り、そこで作業します。

## worktree を作る

worktree は、リポジトリの外の兄弟ディレクトリ `../hono-nx-vite-plus-worktrees/<ブランチ名>` に作ります。
リポジトリの中に置くと、Nx、vp check、IWE がその中のファイルまで拾うためです (この置き場所はこのリポジトリで決めたもので、Git の標準ではありません)。

```sh
branch=feat/example
dir=../hono-nx-vite-plus-worktrees/$branch
git fetch origin
git worktree add -b "$branch" "$dir" origin/main
cd "$dir"
pnpm install --frozen-lockfile   # node_modules は worktree ごとに必要。Git hook は全ての worktree で共有される
```

作業の手順そのものは `using-git-worktrees` skill に従います。

## 片付ける

PR が merge されたら、worktree とブランチを消します。

```sh
git worktree remove ../hono-nx-vite-plus-worktrees/feat/example
git branch -d feat/example
git worktree prune
```
