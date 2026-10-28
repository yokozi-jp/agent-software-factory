---
type: Runbook
title: secret scan
description: betterleaks の誤検知の除外、本物の秘密情報が見つかったときの対処、手動での scan、betterleaks のバージョンの上げ方。secret scan で止まったとき、betterleaks を更新するときに読む。
tags: [tooling, runbook, betterleaks, security]
---

# secret scan

betterleaks が hook と CI で秘密情報を検出します。設定は `.betterleaks.toml` で、デフォルトのルールをそのまま使います。
誤検知は行ごとに除外し、本物の秘密情報はコードから取り除いて無効化します。

## 検出された場所を読む

失敗すると、betterleaks が検出ごとに規則名、path、該当行を出します。秘密の値は `--redact` で `REDACTED` に置き換わるので、出力に値は出ません。出た path と行に、下の除外か取り除きを行います。

## 誤検知を除外する

次のどちらかで個別に除外します。

1. **該当行にコメントを付ける** (推奨): 行末に `betterleaks:allow` を書きます。

   ```ts
   const example = "AKIAXXXXXXXXEXAMPLE"; // betterleaks:allow
   ```

2. **`.betterleaksignore` に fingerprint を書く**: コメントを書けないファイル (JSON など) の場合に使います。
   fingerprint は検出結果の `Fingerprint` 欄に表示されます (`<commit>:<file>:<rule>:<line>` の形式)。1行に1つ書きます。

## 本物の秘密情報だった場合

1. 除外せず、コードから取り除いて環境変数 (`.env`、commit しない) に移します。
   `.env` と `.env.*` は `.gitignore` 済みです。必要な変数の一覧は `.env.example` に書いて commit します。
2. 既に push した場合は、履歴から消しても漏れたものとして扱い、**すぐにその秘密情報を無効化 (rotate)** します。

## 手動で scan する

hook と CI も同じ `tools/scripts/src/checks/secret-scan/cli.ts` を使います。フラグ (`--redact`、`--verbose`、`--config .betterleaks.toml`) はスクリプトが必ず付けるので、渡せるのは調べる対象だけです。

```sh
node tools/scripts/src/checks/secret-scan/cli.ts all        # 全履歴
node tools/scripts/src/checks/secret-scan/cli.ts worktree   # 作業ツリー
```

## betterleaks のバージョンを上げる

マイナー版とパッチ版は Renovate が3つのファイルをまとめて更新する PR を出します ([Renovate](renovate.md))。手で上げるときは、次の2か所を変えてから `mise lock --platform linux-x64` を実行し、3つのファイルを commit します。repo-policy (`tools/scripts/src/checks/repo-policy/cli.ts`) が1と2の一致を確認します。

1. `mise.toml` の `betterleaks`
2. `.betterleaks.toml` の `betterleaksMinVersion`
3. `mise.lock` (`mise lock` が書き換える)

v2 系に上げる場合は、先に [ADR 0003](../adr/0003-pin-betterleaks-v1.md) を見直します。
