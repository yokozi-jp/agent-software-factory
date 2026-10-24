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

| hook         | 実行内容                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit-msg` | commitlint でコミットメッセージを検証                                                                                                                                              |
| `pre-commit` | betterleaks で staged の変更を scan。staged ファイルに `vp check --fix` を実行して修正を stage し、その後 Markdown を lint する                                                    |
| `pre-commit` | 変更したファイルに応じて、`docs-check.sh`、`shellcheck.sh`、`lint-workflows.sh`、`pnpm lint:dup`、`verify-skills-lock.mjs`、`check-repo-policy.sh`、`scripts/test/` のテストを実行 |
| `pre-push`   | main への push を拒否し (`scripts/guard-push.sh`)、betterleaks で push するコミットの範囲を scan                                                                                   |

## hook を一時的に飛ばす

main への push は PR の squash merge と Release workflow だけで行います。main を意図して直すときだけ、`ALLOW_PUSH_TO_MAIN=1 git push ...` で利用者が実行します。

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

`.kiro/hooks/` には、エージェントの操作の前に動く Kiro の PreToolUse hook と、セッションの開始時に警告を出す SessionStart hook があります。Git hook とは別のものです。

Kiro の hook は、信頼した workspace でだけ読まれます。Kiro 2.33.1 の Kiro CLI V3 (`kiro-cli --v3`) で動くことを確かめました。初めて開くと「Trust this workspace?」と聞かれ、信頼すると `~/.kiro/workspace-roots/<hash>/permissions.yaml` に `workspaceTrusted: true` が書かれます。信頼していない workspace では、下の hook はどれも動きません。worktree は workspace として別に数えるので、worktree ごとに信頼します。

| hook                       | 止めるもの                                                                                                                                                                                                                                 | 一時的に許すとき          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `block-force-push`         | `git push` の `--force`、`--force-with-lease`、`-f`、`+<refspec>`                                                                                                                                                                          | `KIRO_ALLOW_FORCE_PUSH=1` |
| `block-iwe-normalize`      | `iwe normalize` ([ADR 0006](../adr/0006-no-iwe-rewrites.md))                                                                                                                                                                               | `IWE_ALLOW_NORMALIZE=1`   |
| `warn-concurrent-sessions` | 止めない。同じ作業ツリーで別の Kiro セッションが動いていれば、セッションの開始時に警告し、ファイルの書き込みと shell の前に利用者へ確認を求める。確認は、別のセッションの組み合わせごとに1回だけ出す ([並行作業と worktree](worktrees.md)) | 不要                      |

force push が必要なときは、履歴を確かめてから利用者が自分で実行します。PR は squash merge なので、main を取り込むための rebase は要りません ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))。
