---
type: Reference
title: CI
description: GitHub Actions の各 workflow が実行するタイミングと内容、ci.yml に含まれる追加の検証。CI が失敗したとき、workflow を変えるときに読む。
tags: [tooling, reference, ci, github-actions]
---

# CI

workflow は `.github/workflows/` にあり、全ての Action は commit SHA で固定しています。
必須チェックにする job が対象外の PR で pending にならないよう、検証は path で絞らずに実行します。

## workflow

| workflow          | 実行タイミング     | 内容                                                       |
| ----------------- | ------------------ | ---------------------------------------------------------- |
| `ci.yml`          | PR、main への push | 下の検証と `nx affected -t check test build`               |
| `commitlint.yml`  | PR                 | PR タイトルと PR 内の全コミットを検証                      |
| `secret-scan.yml` | PR、main への push | PR は PR のコミットを、main は全履歴を betterleaks で scan |
| `release.yml`     | 手動               | `nx release` ([リリース](../repository/release.md))        |

## ci.yml の検証

どれも、対応するファイルを変えたときに pre-commit hook でも実行します。

- `scripts/check-repo-policy.sh`: ADR の決定を機械的に確認します (`@nx/vite` がない、`vite.config.ts` に `run` がない、`.vite-hooks` がない、betterleaks のバージョンが一致している)。
- `scripts/verify-skills-lock.mjs`: `.agents/skills` が `skills-lock.json` の記録と一致し、`.kiro/skills` に各 skill への symlink があることを確認します。skill は upstream からインストールしたものなので、手で編集しません。
- `pnpm lint:md`: 全ての Markdown を markdownlint-cli2 で検査します。
- `scripts/docs-check.sh`: `docs/` を OKF v0.2 バンドルとして検査します ([docs の書き方](../knowledge/documentation-authoring.md))。
- build の後に `git status` が空であること: `routeTree.gen.ts` などの生成ファイルを commit し忘れると失敗します。
