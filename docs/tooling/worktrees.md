---
type: Runbook
title: 並行作業と worktree
description: 複数の Kiro セッションや人が同時に作業するときに、git worktree で作業ツリーを分ける手順、PR を出す前後の確認、片付け方。別のセッションが同じ作業ツリーで動いていると警告されたとき、並行して作業を始めるとき、worktree から PR を出すときに読む。
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

worktree は、リポジトリの外の兄弟ディレクトリ `<main の作業ツリー>-worktrees/<ブランチ名>` (このマシンでは `/home/projects/agent-software-factory-worktrees/<ブランチ名>`) に作ります。
リポジトリの中に置くと、Nx、vp check、IWE がその中のファイルまで拾うためです (この置き場所はこのリポジトリで決めたもので、Git の標準ではありません)。
`scripts/worktree.sh` が、main の作業ツリーを git の共通のディレクトリから求めて置き場所を決めるので、main の作業ツリー、別の worktree、そのどのサブディレクトリから実行しても、同じ場所に作ります。

```sh
cd "$(scripts/worktree.sh add feat/example)"   # origin/main からブランチを作り、pnpm install --frozen-lockfile まで行う
```

`add` は、標準出力に worktree の絶対 path だけを出します。node_modules は worktree ごとに入れ、Git hook は全ての worktree で共有されます。
Kiro の file tool (読む、書く、編集する) は、相対 path を worktree ではなく workspace root (main の作業ツリー) に対して解決します。worktree のファイルは絶対 path で渡します。相対 path のまま書くと、別のセッションが使っている main の作業ツリーのファイルを書き換えます。shell のコマンドは、`cwd` に worktree を指定すれば相対 path で構いません。
作業の手順そのものは `using-git-worktrees` skill に従います。

## PR を出す

worktree を作った後も、別の PR が main に入り続けます。番号を振るもの (ADR の `NNNN`) は、ほかの PR と同じ番号を取りやすい箇所です。

1. push の前に `git fetch origin` し、`scripts/check-adr-number.sh` を実行します。このブランチで足した ADR の番号が、`origin/main` とほかの open な PR で使われていないかを確かめ、次の空いている番号を表示します。使われていたら (exit 1)、表示された番号に付け替え、その番号を参照している箇所も直します。pre-push hook も同じ検査を実行し、番号が重なっていれば push を止めます (`gh` が読めないときは止めません)。`gh` で PR の一覧を取れないと exit 2 で止まるので、`gh auth status` を確かめてもう一度実行します。
   番号を決めるとき (ADR を書き始めるとき) にも実行します。同じ main の上でも、open な PR が先に番号を取っていることがあります。merge された後の重複は `scripts/check-repo-policy.sh` でも止まります。
2. PR を作った後、`gh pr checks` が `no checks reported` のままなら、`gh pr view --json mergeable,mergeStateStatus` を見ます。`CONFLICTING` の PR では、`pull_request` の workflow が始まりません。main を merge して衝突を直し、push します。PR は squash merge なので、rebase や force push は要りません。

## 片付ける

PR が merge されたら、worktree とブランチを消します。

```sh
branch=feat/example
gh pr view "$branch" --json state --jq .state   # MERGED であることを確かめる
git worktree remove "$(scripts/worktree.sh path "$branch")"
git fetch origin
files=$(git diff --name-only "$(git merge-base "$branch" origin/main)" "$branch")
git diff --quiet "$branch" origin/main -- $files && git branch -D "$branch"
git worktree prune
```

PR は squash merge なので ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))、ブランチの commit は main の履歴に入らず、`git branch -d` は `not fully merged` で必ず止まります。
そこで、ブランチで変えたファイルの中身が main と同じことを確かめてから、`-D` で消します。
merge の後に別の PR が同じファイルを変えていると `git diff --quiet` が失敗し、ブランチは残ります。そのときは差分を読み、ブランチにしかない変更がないことを確かめてから消します。
