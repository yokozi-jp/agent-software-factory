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

| hook         | 実行内容                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit-msg` | commitlint でコミットメッセージを検証                                                                                                                             |
| `pre-commit` | betterleaks で staged の変更を scan。staged ファイルに `vp check --fix` を実行して修正を stage し、その後 Markdown を lint する                                   |
| `pre-commit` | 変更したファイルに応じて、`docs-check.sh`、`shellcheck.sh`、`lint-workflows.sh`、`verify-skills-lock.mjs`、`check-repo-policy.sh`、`scripts/test/` のテストを実行 |
| `pre-push`   | main への push を拒否し (`scripts/guard-push.sh`)、betterleaks で push するコミットの範囲を scan                                                                  |

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

hook は jq で event の JSON を読みます。jq がないと、`block-generated-writes` と `warn-concurrent-sessions` は何もせずに exit 0 で終わり、操作をそのまま通します。`block-force-push` と `block-iwe-normalize` は、jq がなければ JSON 全体を文字列として調べます。jq は [開発環境の構築](../local-env-setup/setup.md) の手順で入ります。

| hook                       | 止めるもの                                                                                                                                                                                                                                 | 一時的に許すとき               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `block-force-push`         | `git push` の `--force`、`--force-with-lease`、`-f`、`+<refspec>`                                                                                                                                                                          | `KIRO_ALLOW_FORCE_PUSH=1`      |
| `block-iwe-normalize`      | `iwe normalize` ([ADR 0006](../adr/0006-no-iwe-rewrites.md))                                                                                                                                                                               | `IWE_ALLOW_NORMALIZE=1`        |
| `block-generated-writes`   | 生成物を、ファイルの作成、置換、追記、削除の tool で書き換えること。拒否の理由と再生成の方法を返す (下の表)。読み取りは止めない                                                                                                            | `KIRO_ALLOW_GENERATED_WRITE=1` |
| `warn-concurrent-sessions` | 止めない。同じ作業ツリーで別の Kiro セッションが動いていれば、セッションの開始時に警告し、ファイルの書き込みと shell の前に利用者へ確認を求める。確認は、別のセッションの組み合わせごとに1回だけ出す ([並行作業と worktree](worktrees.md)) | 不要                           |

force push が必要なときは、履歴を確かめてから利用者が自分で実行します。PR は squash merge なので、main を取り込むための rebase は要りません ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))。

### 生成物への書き込み

`block-generated-writes` が止めるファイルと、代わりに使う再生成の方法です。

| ファイル                                                   | 書くもの                               | 再生成の方法                                                                        | 最後の網になる CI の検査                                                                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routeTree.gen.ts` (`apps/web/src/routeTree.gen.ts` など)  | TanStack Router (build のときに生成)   | `apps/web/src/routes/` を直して `pnpm exec nx build web`                            | `Generated files are committed` (build の後に差分が残ると失敗)                                                                                                              |
| `.agents/skills/**`、`.kiro/skills/**`、`skills-lock.json` | skills CLI (upstream からインストール) | `pnpm dlx skills update`、または `pnpm dlx skills add <source>`                     | `Agent skills match skills-lock.json` (`scripts/verify-skills-lock.mjs`)                                                                                                    |
| `pnpm-lock.yaml`                                           | pnpm                                   | `package.json` か `pnpm-workspace.yaml` を直して `pnpm install` (または `pnpm add`) | `setup-vp` の `vp install`。CI では pnpm が lockfile を更新せず、更新が要る lockfile で失敗する ([pnpm の `frozenLockfile`](https://pnpm.io/settings/store#frozenlockfile)) |
| `mise.lock`                                                | `mise lock`                            | `mise.toml` を直して `mise lock --platform linux-x64`                               | `jdx/mise-action` (`MISE_LOCKED=1`)。lock の記録だけを、checksum を確かめて入れる ([ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))                                    |

hook が見るのは、Kiro 2.33.1 のエンジン (`~/.local/share/kiro-cli/kas/<版>/node_modules/@kiro/agent/dist/server/acp-server.js`) で確かめた tool と項目です。`tool_name` には tool の id が、`tool_input` には tool の入力がそのまま入ります。`fs_write`、`str_replace`、`fs_append` は `path` を、`delete_file` は `targetFile` を見ます。相対 path は event の `cwd` から解決します。Kiro は `cwd` に最初の workspace root を入れ、file tool も workspace root から path を解決するためです。`.kiro/skills/<name>` のような symlink も実体の path に直してから判定します。skills CLI のコマンドは [skills の README](https://github.com/vercel-labs/skills#readme) にあります。

次の経路は hook では止められません。上の表の CI の検査が最後の網です。

- shell のリダイレクトやコマンド (`>`、`sed -i`、`cp`、`rm` など)。hook は shell のコマンドを解析しません
- `code` tool の `format_code` と `rename_symbol`。入力に書き込む path の一覧がありません
- MCP server の tool と、IDE のクライアントが提供する tool (`smart_relocate` など)
- Kiro の外での編集 (エディタ、ほかのエージェント)
