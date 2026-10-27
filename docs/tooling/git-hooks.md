---
type: Reference
title: Git hook
description: lefthook で設定した commit-msg、pre-commit、pre-push の各 hook と、エージェントの操作を止める Kiro の hook が実行する内容、hook を一時的に飛ばす方法、動かないときの直し方。hook で失敗したとき、hook を変えるときに読む。
tags: [tooling, reference, lefthook, git-hooks]
---

# Git hook

hook は `lefthook.yml` で定義し、`pnpm install` の `prepare` で設定されます ([ADR 0001](../adr/0001-lefthook-for-git-hooks.md))。
型チェックとテストは hook では実行せず、CI に任せます。例外は `tools/scripts` のテストで、`tools/scripts/**`、`.kiro/hooks/*.json`、Nx の `sharedGlobals` のどれかのファイルを変えた commit の pre-commit が `nx test scripts` を実行します (Nx の cache が効くので、変わっていなければすぐ終わります)。本物の道具を使うテスト (`*.tools.test.ts`) は数分かかるので、pre-commit ではなく pre-push の `nx-affected-test-tools` が、push するブランチが影響を与える project について `nx affected -t test-tools` として実行します。何が影響を受けるかは、`tools/scripts/package.json` の `test-tools` の `inputs` で決まり、結果が変わらなければ Nx の cache ですぐ終わります。mise の道具が要るので、`mise install --locked` を済ませておきます。CI はこの project を変えたすべての PR で実行します。

## 実行内容

どの hook のどの job が何を確かめ、どの CI の検証の写しかは、[保証カタログ](assurance-catalog.md) の「ローカルの写し」の列と、`lefthook: …` の行にあります。hook は飛ばせるので、保証には数えません。

- `commit-msg` はコミットメッセージを、`pre-commit` はステージした変更を、`pre-push` は push するコミットを見ます。
- `pre-commit` は、staged ファイルに `vp check --fix` を実行して修正を stage してから、Markdown を lint します。`glob` を持つ job は、それに合うファイルを変えたときだけ実行します。
- `pre-push` の adr-check、test-weakening、OSV-Scanner は警告だけで、止めません。adr-number は `gh` が読めないとき、Semgrep はオフラインなど検査できないときは止めません。

## hook を一時的に飛ばす

main への push は PR の squash merge と Release workflow だけで行います。main を意図して直すときだけ、`ALLOW_PUSH_TO_MAIN=1 git push ...` で利用者が実行します。

```sh
LEFTHOOK=0 git commit ...                # 全 hook を飛ばす
LEFTHOOK_EXCLUDE=check git commit ...    # 特定のジョブだけ飛ばす
git commit --no-verify ...               # Git 標準の方法
```

飛ばしても CI で同じ検証を実行するので、問題は PR の段階で止まります。
secret scan を飛ばして秘密情報を push してしまった場合は、[secret scan](secret-scan.md) の手順で対処します。

`pre-push` の adr-check は警告だけで、push を止めません。ADR が要らない変更の警告は、`ADR_ACK=1 git push ...` で抑えます ([ADR 0016](../adr/0016-adr-check-warns-without-blocking.md))。判断の基準は [docs の書き方](../knowledge/documentation-authoring.md#adr-を書くかどうか) にあります。

`pre-push` の test-weakening も警告だけです。テストを消すか減らすのが意図した変更なら、`TESTS_ACK=1 git push ...` で抑え、理由を PR の本文に書きます。

## hook が動かないとき

```sh
pnpm exec lefthook install          # hook を設定し直す
pnpm exec lefthook run pre-commit   # hook を手動で実行
```

## Kiro の hook

`.kiro/hooks/` には、エージェントの操作の前に動く Kiro の PreToolUse hook と、セッションの開始時に警告を出す SessionStart hook があります。Git hook とは別のものです。

Kiro の hook は、信頼した workspace でだけ読まれます。Kiro 2.33.1 の Kiro CLI V3 (`kiro-cli --v3`) で動くことを確かめました。初めて開くと「Trust this workspace?」と聞かれ、信頼すると `~/.kiro/workspace-roots/<hash>/permissions.yaml` に `workspaceTrusted: true` が書かれます。信頼していない workspace では、下の hook はどれも動きません。worktree は workspace として別に数えるので、worktree ごとに信頼します。

hook は trigger ごとに 1 つです。`pre-tool-use.json` と `session-start.json` が、それぞれ 1 つの Node.js のプロセス (`tools/scripts/src/hooks/<trigger>/cli.ts`) を起動し、どの検査をするかは tool の名前でコードの中で決めます ([ADR 0024](../adr/0024-scripts-and-hooks-in-typescript.md))。PreToolUse の `matcher` は、どれかの検査が見る tool の名前を並べたもので、ほかの tool (読み取りや検索) では Node.js を起動しません。event の JSON は Node.js で読み、jq は使いません。command の `NODE_COMPILE_CACHE` は、Node.js の compile cache を一時ディレクトリに置き、2 回目からの起動を速くします ([Node.js の Module compile cache](https://nodejs.org/docs/latest-v24.x/api/module.html#module-compile-cache))。読めない event は、操作をそのまま通します。node が起動しないときも同じです (Kiro は exit 0 と 2 以外を、操作を止めない失敗として扱います)。

Kiro 2.34.0 のエンジン (`~/.local/share/kiro-cli/kas/<版>/node_modules/@kiro/agent/dist/server/acp-server.js`) は、条件に合う hook を 1 つずつ順に実行します。PreToolUse の hook は exit 2 で操作を止め、stderr をエージェントに返します。利用者に確認を求める (exit 0 で stdout に `{"hookSpecificOutput":{"permissionDecision":"ask",…}}` を書く) 検査はありません。

下の検査は、[保証カタログ](assurance-catalog.md) に `kiro: <hook>/<検査>` の行として載っています。どれもガードレールか警告で、保証には数えません。検査のファイルの 1 行目 (`// block-…:` か `// warn-…:`) が検査の名前で、カタログに行がなければ repo-policy が止めます。

| 検査                       | 止めるもの                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 一時的に許すとき               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `block-force-push`         | コマンドの位置にある `git push` の `--force`、`--force-with-lease`、`-f`、`+<refspec>`。`env`、`sudo`、`xargs` などの後と、`sh -c "…"` の文字列の中も見る。コミットメッセージや PR の本文、`echo` の引数、シェルに渡さない heredoc の本文のように、文字として書いてあるだけの `git push` は見ない。引用符の中の改行は新しいコマンドの始まりと読むので、複数行のメッセージで行頭が `git push --force` だと止まる。スクリプトの中の push とエイリアスは見ない | `KIRO_ALLOW_FORCE_PUSH=1`      |
| `block-iwe-normalize`      | `iwe normalize` ([ADR 0006](../adr/0006-no-iwe-rewrites.md))。shell では `block-force-push` と同じく、コマンドの位置にあるものだけを見る (`pnpm exec`、`npx`、`node_modules/.bin/iwe` の後も見る)。iwe の MCP server の tool は、名前に `iwe` と `normalize` を含むものを止める                                                                                                                                                                             | `IWE_ALLOW_NORMALIZE=1`        |
| `block-generated-writes`   | 生成物を、ファイルの作成、置換、追記、削除の tool で書き換えること。拒否の理由と再生成の方法を返す (下の表)。読み取りは止めない                                                                                                                                                                                                                                                                                                                             | `KIRO_ALLOW_GENERATED_WRITE=1` |
| `block-forbidden-commands` | main への push、`gh pr merge`、`--no-verify`、`gh secret` と `gh variable` の全サブコマンドと `gh repo delete`、ruleset と Actions の設定を変える `gh api`、認証情報 (`~/.aws`、`~/.ssh`、`~/.config/gh`、`.env*`、`gh auth token`) を読むコマンド、`aws` と `cdk deploy`/`cdk destroy`、`curl \| sh`。コマンドの位置を見る範囲は `block-force-push` と同じ。拒否の理由と代わりの手順を返す ([エージェントの権限](agent-permissions.md))                    | なし (利用者が自分で実行する)  |
| `block-settings-writes`    | `.kiro/settings/` を、ファイルの作成、置換、追記、削除の tool で書き換えること。shell のリダイレクトは見ない ([エージェントの権限](agent-permissions.md))                                                                                                                                                                                                                                                                                                   | なし (利用者が自分で編集する)  |
| `warn-concurrent-sessions` | 止めない。同じ作業ツリーで別の Kiro セッションが動いていれば、セッションの開始時に警告する。ファイルの書き込みと shell の前には確かめないので、後から始まったセッションは見つけない (毎回の確認がうるさいため、[PR #191](https://github.com/yokozi-jp/agent-software-factory/pull/191)) ([並行作業と worktree](worktrees.md))                                                                                                                               | 不要                           |
| `warn-stale-checkout`      | 止めない。main の作業ツリーが origin/main より遅れていれば、セッションの開始時に警告する。origin/main を fetch してから調べる (5 秒まで。fetch できなければ手元の ref を使う)。feature ブランチと、origin のない clone では何も言わない ([並行作業と worktree](worktrees.md))                                                                                                                                                                               | 不要                           |

force push が必要なときは、履歴を確かめてから利用者が自分で実行します。PR は squash merge なので、main を取り込むための rebase は要りません ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))。

### 生成物への書き込み

`block-generated-writes` が止めるファイルと、代わりに使う再生成の方法です。

| ファイル                                                   | 書くもの                                                                            | 再生成の方法                                                                        | 最後の網になる CI の検査                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routeTree.gen.ts` (`apps/web/src/routeTree.gen.ts` など)  | TanStack Router の bundler の plugin (dev と build のときに生成)                    | `apps/web/src/routes/` を直して `pnpm exec nx build web`                            | `Generated files are committed` (build の後に差分が残ると失敗)                                                                                                                                                                                 |
| `.agents/skills/**`、`.kiro/skills/**`、`skills-lock.json` | skills CLI (upstream からインストール)                                              | `pnpm dlx skills update`、または `pnpm dlx skills add <source>`                     | `Agent skills match skills-lock.json` (`tools/scripts/src/checks/skills-lock/`)                                                                                                                                                                |
| `pnpm-lock.yaml`                                           | pnpm                                                                                | `package.json` か `pnpm-workspace.yaml` を直して `pnpm install` (または `pnpm add`) | `setup-vp` の `vp install`。CI では pnpm が lockfile を更新せず、更新が要る lockfile で失敗する ([pnpm の `frozenLockfile`](https://pnpm.io/settings/store#frozenlockfile))                                                                    |
| `mise.lock`、`.mise/locks/**`                              | `mise lock`                                                                         | `mise.toml` を直して `mise lock --platform linux-x64`                               | `jdx/mise-action` (`MISE_LOCKED=1`)。lock の記録だけを、checksum を確かめて入れる。`.mise/locks/` は PyPI の道具 (Semgrep) の依存のグラフで、digest が `mise.lock` と合わないと失敗する ([ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md)) |
| `packages/*/src/infrastructure/db.gen.ts`                  | kysely-codegen (migration を流した PostgreSQL から、モジュールのスキーマごとに生成) | `apps/api/db/migrations/` を直して `pnpm exec nx db-types api`                      | `DB types match the migrations` (生成し直した型と違うと失敗する。[ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md))                                                                                                                       |

表の「書くもの」と「再生成の方法」の出典は次のとおりです。TanStack Router は [File-Based Routing](https://tanstack.com/router/latest/docs/routing/file-based-routing) と [Installation with Vite](https://tanstack.com/router/latest/docs/installation/with-vite)、skills CLI は [skills の README](https://github.com/vercel-labs/skills#readme)、kysely-codegen は [kysely-codegen の README](https://github.com/RobinBlomberg/kysely-codegen) です。

hook が見るのは、Kiro 2.33.1 のエンジン (`~/.local/share/kiro-cli/kas/<版>/node_modules/@kiro/agent/dist/server/acp-server.js`) で確かめた tool と項目です。`tool_name` には tool の id が、`tool_input` には tool の入力がそのまま入ります。`fs_write`、`str_replace`、`fs_append` は `path` を、`delete_file` は `targetFile` を見ます。相対 path は event の `cwd` から解決します。Kiro は `cwd` に最初の workspace root を入れ、file tool も workspace root から path を解決するためです。`.kiro/skills/<name>` のような symlink も実体の path に直してから判定します。

次の経路は hook では止められません。上の表の CI の検査が最後の網です。

- shell のリダイレクトやコマンド (`>`、`sed -i`、`cp`、`rm` など)。hook は shell のコマンドを解析しません
- `code` tool の `rename_symbol`。入力にない複数のファイルを書き換えます
- `code` tool の `format_code`。入力の `file_path` を書き換えますが、この hook は `code` tool を見ていません
- MCP server の tool と、IDE のクライアントが提供する tool (`smart_relocate` など)
- Kiro の外での編集 (エディタ、ほかのエージェント)
