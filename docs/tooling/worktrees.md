---
type: Runbook
title: 並行作業と worktree
description: 複数の Kiro セッションや人が同時に作業するときに、git worktree で作業ツリーを分ける手順、PR を出す前後の確認、片付け方。別のセッションが同じ作業ツリーで動いている、または main の作業ツリーが origin/main より古いと警告されたとき、並行して作業を始めるとき、worktree から PR を出すときに読む。
tags: [tooling, runbook, git, worktree, kiro]
---

# 並行作業と worktree

同じ作業ツリーで2つのセッションが動くと、index とファイルを上書きし合います。
並行して作業するときは、セッションごとに `git worktree` で作業ツリーを分けます。
Kiro の hook (`tools/scripts/src/hooks/concurrent-sessions.ts`) は、同じ作業ツリーで別の Kiro セッションが動いていると、セッションの開始時に警告します。ファイルの書き込みと shell の前には確かめないので、このセッションより後に始まったセッションは見つけません。前は確かめて利用者に確認を求めていましたが、毎回の確認がうるさいので外しました ([PR #191](https://github.com/yokozi-jp/agent-software-factory/pull/191))。

## 警告が出たとき

1. 編集、commit、ブランチの切り替えをする前に、利用者に伝えます。
2. 下の手順で worktree を作り、そこで作業します。

## 作業ツリーが古いと警告されたとき

main の作業ツリーが origin/main より遅れていると、そこにある docs、ADR、設定は古い内容です。それを読んで調べたり決めたりすると、すでに変わったことを前提にしてしまいます。Kiro の hook (`tools/scripts/src/hooks/stale-checkout.ts`) は、セッションの開始時に origin/main を fetch し、main にいて遅れていれば、遅れた commit 数と違いのあるファイルを警告します。feature ブランチは、普段から origin/main より遅れているので警告しません。

1. 調べる前に、`git show origin/main:<path>` か `git diff --stat HEAD origin/main` で origin/main の内容を読みます。
2. 作業は、下の手順で origin/main から worktree を作って行います。
3. main の作業ツリーを `git pull` で進めるのは、別のセッションがいないことを確かめ、利用者に伝えてからにします。hook は作業ツリーを変えません。

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

## 開発サーバーを動かす

別のセッションも同じマシンで開発サーバーを動かします。ポートを worktree ごとに分ける仕組みはまだなく、[Issue #184](https://github.com/yokozi-jp/agent-software-factory/issues/184) で扱います。

- Vite は、指定したポートが塞がっていると、失敗せずに次のポートで起動します。起動したときの出力で実際のポートを読み、決め打ちしません。
- 動作確認の前に `ss -ltnp` でそのポートの持ち主を確かめます。持ち主の cwd (`readlink /proc/<pid>/cwd`) が自分の worktree なら自分のプロセスです。
- 止めるのは、自分が起動したプロセスだけです。pid を確かめて `kill <pid>` します。`pkill -f` や `killall` は、パターンに合う別のセッションのプロセスまで止めるので使いません。

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
