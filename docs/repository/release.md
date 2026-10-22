---
type: Runbook
title: リリース
description: nx release で api と web に独立したバージョン、CHANGELOG、タグ、GitHub Release を作る手順と、バージョンの決まり方。リリースするときに読む。
tags: [repository, runbook, release, nx]
---

# リリース

GitHub Actions の Release workflow を `main` で手動実行し、まず dry-run で確認してから本番を実行します。
`api` と `web` に独立したバージョンを付け、npm には publish しません。

## バージョンの決まり方

- バージョンは前回のリリースからのコミットで決まります。`fix` は patch、`feat` は minor、破壊的変更は major を上げます。
  ただし `0.x` の間は 1段下がり、`feat` は patch、破壊的変更は minor になります (Nx の `adjustSemverBumpsForZeroMajorVersion`)。
- プロジェクトごとに `apps/<name>/CHANGELOG.md`、git タグ `<name>@<version>`、GitHub Release を作ります。

## 手順

1. GitHub の **Actions → Release → Run workflow** を開き、`main` で実行します。
2. まず `dry-run` にチェックを入れたまま実行し、ログで次のバージョンと CHANGELOG を確認します。
3. 問題なければ `dry-run` を外して実行します。初回だけ `first-release` にチェックを入れます (前回のタグがないため)。

ローカルでの確認:

```sh
pnpm exec nx release --dry-run --skip-publish                   # 2回目以降
pnpm exec nx release --dry-run --skip-publish --first-release   # 初回
```

## 注意

Release workflow は `chore: release` コミットとタグを main に直接 push します。
main に branch protection を設定する場合は、`github-actions[bot]` が push できるように bypass を許可します ([GitHub リポジトリの設定](github-settings.md))。
