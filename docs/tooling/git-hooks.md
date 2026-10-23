---
type: Reference
title: Git hook
description: lefthook で設定した commit-msg、pre-commit、pre-push の各 hook と、エージェントの操作を止める Kiro の hook が実行する内容、hook を一時的に飛ばす方法、動かないときの直し方。hook で失敗したとき、hook を変えるときに読む。
tags: [tooling, reference, lefthook, git-hooks]
---

# Git hook

hook は `lefthook.yml` で定義し、`pnpm install` の `prepare` で設定されます ([ADR 0001](../adr/0001-lefthook-for-git-hooks.md))。
型チェックとテストは hook では実行せず、CI に任せます。

## 実行内容

| hook         | 実行内容                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `commit-msg` | commitlint でコミットメッセージを検証                                                                                           |
| `pre-commit` | betterleaks で staged の変更を scan。staged ファイルに `vp check --fix` を実行して修正を stage し、その後 Markdown を lint する |
| `pre-commit` | 変更したファイルに応じて、`docs-check.sh`、`shellcheck.sh`、`verify-skills-lock.mjs`、`check-repo-policy.sh` を実行             |
| `pre-push`   | betterleaks で push するコミットの範囲を scan                                                                                   |

## hook を一時的に飛ばす

```sh
LEFTHOOK=0 git commit ...                # 全 hook を飛ばす
LEFTHOOK_EXCLUDE=check git commit ...    # 特定のジョブだけ飛ばす
git commit --no-verify ...               # Git 標準の方法
```

飛ばしても CI で同じ検証を実行するので、問題は PR の段階で止まります。
secret scan を飛ばして秘密情報を push してしまった場合は、[secret scan](secret-scan.md) の手順で対処します。

## hook が動かないとき

```sh
pnpm exec lefthook install          # hook を設定し直す
pnpm exec lefthook run pre-commit   # hook を手動で実行
```

## Kiro の hook

`.kiro/hooks/` には、エージェントの shell の実行を止める Kiro の PreToolUse hook があります。Git hook とは別のものです。

| hook                  | 止めるもの                                                        | 一時的に許すとき          |
| --------------------- | ----------------------------------------------------------------- | ------------------------- |
| `block-force-push`    | `git push` の `--force`、`--force-with-lease`、`-f`、`+<refspec>` | `KIRO_ALLOW_FORCE_PUSH=1` |
| `block-iwe-normalize` | `iwe normalize` ([ADR 0006](../adr/0006-no-iwe-rewrites.md))      | `IWE_ALLOW_NORMALIZE=1`   |

force push が必要なときは、履歴を確かめてから利用者が自分で実行します。PR は squash merge なので、main を取り込むための rebase は要りません ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))。
