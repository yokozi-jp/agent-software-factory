---
type: Reference
title: CI
description: GitHub Actions の各 workflow が実行するタイミングと内容、ci.yml に含まれる追加の検証。CI が失敗したとき、workflow を変えるときに読む。
tags: [tooling, reference, ci, github-actions]
---

# CI

workflow は `.github/workflows/` にあり、全ての Action は commit SHA で固定し、更新は Renovate の PR で行います ([Renovate](renovate.md))。
必須チェックにする job が対象外の PR で pending にならないよう、検証は path で絞らずに実行します。

## workflow

| workflow          | 実行タイミング     | 内容                                                       |
| ----------------- | ------------------ | ---------------------------------------------------------- |
| `ci.yml`          | PR、main への push | 下の検証と `nx affected -t check test build`               |
| `commitlint.yml`  | PR                 | PR タイトルと PR 内の全コミットを検証                      |
| `secret-scan.yml` | PR、main への push | PR は PR のコミットを、main は全履歴を betterleaks で scan |
| `release.yml`     | 手動               | `nx release` ([リリース](../repository/release.md))        |

## ci.yml の検証

どれも、対応するファイルを変えたときに pre-commit hook でも実行します (`scripts/adr-check.sh` は pre-push hook で実行し、その test を pre-commit hook で実行します)。

- `scripts/check-repo-policy.sh`: ADR の決定を機械的に確認します (`@nx/vite` がない、`vite.config.ts` に `run` がない、`.vite-hooks` がない、betterleaks のバージョンが一致している、ADR の番号が重複していない、Node.js のメジャー版が `.node-version`・`engines.node`・`@types/node` の catalog・`vite.config.ts` の build target でそろっている、`ci.yml` の `main` 以外の全ての job が `main` の `needs` に入っている)。CI は作業ツリーを、pre-commit は `staged` を付けてステージした内容を検査します。ステージしていない他のファイルの編集で、コミットが止まらないようにするためです。
  `docs/` の外 (スクリプト、設定、`AGENTS.md`、workflow) に書いた `docs/...md` のパス、`docs/...md ("見出し")` の見出し、`docs/adr/NNNN` の番号が実在することも確認します。見出しは番号を付けずに書きます。
  `ci.yml` の `main` が必須チェックをまとめる job のとき、`needs` に入っていない job は、失敗しても merge を止めません。そこで `needs` は 1 行の `needs: [a, b]` の形で書き、`main` 以外の job が全て入っていることを確認します。
  `git init`、`git clone`、`git -C`、`--git-dir`、`GIT_DIR=` で別のリポジトリを操作するスクリプトは、`scripts/test/lib.sh` を読み込んだテストの中だけに置けます (理由は「スクリプトのテスト」)。
  `scripts/test/*.test.sh` がどれも workflow と `lefthook.yml` の両方で実行されること (コメントの中の名前は数えません)、git で管理しているシェルスクリプトの mode が `100755` であることも確認します。
- `scripts/test/run.sh`: スクリプトと Kiro の hook の動作をテストします ([スクリプトのテスト](#スクリプトのテスト))。
- `scripts/adr-check.sh`: 依存、ツールの設定、workflow、ruleset、Kiro の hook や設定 (対象は `scripts/adr-check.sh` の `decision_path`) を変えたのに、PR の base との差分に ADR (`docs/adr/NNNN-*.md`) の追加がないと、`::warning::` を出します。job は失敗させません ([ADR 0016](../adr/0016-adr-check-warns-without-blocking.md))。テストと fixture の変更は対象外です。base と比べられない (浅い clone など) ときは、理由を `::notice::` に出して通します。pre-push hook でも実行します ([Git hook](git-hooks.md))。
- `scripts/shellcheck.sh`: git で管理しているシェルスクリプト (`.agents/` を除く) を shellcheck で検査します。版は `mise.toml` と `mise.lock` で固定し、CI は `jdx/mise-action` で lock のとおりに入れます ([ADR 0008](../adr/0008-pin-shellcheck.md)、[ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。
- `scripts/lint-workflows.sh`: git で管理している `.github/workflows/` の workflow を actionlint と zizmor で検査します ([ADR 0012](../adr/0012-lint-workflows.md))。actionlint は構文、式の型、参照の誤りを、zizmor は script injection、過大な権限、`persist-credentials` の書き忘れなどを見つけます。actionlint は `run:` のスクリプトも固定した shellcheck で検査します。
  zizmor は `--offline` で動かすので、GitHub API を使う audit は実行しません ([zizmor の Usage](https://docs.zizmor.sh/usage/))。版は shellcheck と同じく mise で固定します。指摘を抑制するときは、その場所に理由を書きます (`# zizmor: ignore[<audit>]`、`# shellcheck disable=SCxxxx`)。
- `scripts/verify-skills-lock.mjs`: `.agents/skills` が `skills-lock.json` の記録と一致し、`.kiro/skills` に各 skill への symlink があることを確認します。skill は upstream からインストールしたものなので、手で編集しません。
- `pnpm lint:md`: 全ての Markdown を markdownlint-cli2 で検査します。
- `scripts/docs-check.sh`: `docs/` を OKF v0.2 バンドルとして検査します ([docs の書き方](../knowledge/documentation-authoring.md))。文書へのリンクが `.md` で終わることも見ます (GitHub は拡張子のないリンクをたどれません)。CI は `staged` を付けずに実行するので、`about.md` の記録の検査は pre-commit だけで行います。
- `scripts/renovate.sh validate`: `renovate.jsonc` を、`scripts/renovate.sh` に固定した版の Renovate の `renovate-config-validator --strict` で検査します ([Renovate](renovate.md))。`pnpm dlx` で Renovate を取るので、ネットワークが要ります。
- `pnpm check:root` (`scripts/check-root-files.sh`): `apps/`、`packages/`、`tools/` の外にあるファイル (ルートの設定ファイル、`scripts/`、`docs/`、`.github/` など) に `vp check` を実行します。
  各プロジェクトの `check` は Nx のプロジェクトの中のファイルしか見ないので、これらのファイルはこのステップで検査します。
  対象は `git ls-files` で選ぶので、commit していない作業用のファイルは検査しません。
  pre-commit hook では、ステージしたファイルに `vp check --fix` を実行します。
- `pnpm lint:dup` (jscpd): `apps/` と `packages/` の JavaScript、TypeScript、CSS の重複を検査し、重複率が `.jscpd.json` の `threshold` を超えると失敗します ([ADR 0014](../adr/0014-jscpd-duplication-threshold.md))。
  `.gitignore` の対象 (`dist`、`.tanstack/` など)、生成物 (`routeTree.gen.ts`)、テストの fixture は対象外です。閾値の値と、それを決めた理由は ADR 0014 に書きます。clone はファイルをまたぐので、pre-commit hook でもステージした内容ではなく作業ツリー全体を検査します。意図した重複は `// jscpd:ignore-start` と `// jscpd:ignore-end` で囲み、理由を書きます。
- `pnpm lint:unused` (Knip): pnpm workspace の全てのプロジェクトとルートで、どこからも使われていないファイル、export、依存を見つけると失敗します ([ADR 0017](../adr/0017-knip-unused-code.md))。設定は `knip.jsonc` です。
  Knip が読めない場所 (シェルスクリプト、Kiro の設定など) からだけ使うファイルや依存は、`knip.jsonc` に例外として個別に書き、理由をそのそばに書きます。意図して残す export には `/** @public */` と理由を書きます。不要になった例外も失敗します (`treatConfigHintsAsErrors`)。
  未使用かどうかはほかのファイルの import で決まるので、pre-commit hook でもステージした内容ではなく作業ツリー全体を検査します。
- build の後に `git status` が空であること: `routeTree.gen.ts` などの生成ファイルを commit し忘れると失敗します。

## 検査を足すとき

検査はローカルと CI で同じコマンドを呼ぶので、1 つ足すと次の場所を全部直します。`pnpm lint:dup` (jscpd) を足した PR #91 が例です。

1. コマンド: リポジトリ全体を見る検査は、`scripts/<name>.sh` か、ルートの `package.json` の script にします。プロジェクトごとの検査は、そのプロジェクトの `package.json` の script にし、Nx の target として動かします。どちらも `vp run` は使いません ([ADR 0002](../adr/0002-nx-orchestrates-vite-plus.md))。道具の版は、npm で配られるものは `pnpm-workspace.yaml` の catalog で、それ以外は `mise.toml` で固定します ([ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。
2. `ci.yml` の `main` job に step を足します。
3. `lefthook.yml` の `pre-commit` に job を足します。`glob` には、検査の対象のファイルと、道具の版を固定するファイル (`pnpm-workspace.yaml` か `mise.toml` と `mise.lock`) を入れます。
4. 止めるべき入力で失敗し、通すべき入力で通ることを `scripts/test/<name>.test.sh` で確かめ、`ci.yml` の Script tests と `lefthook.yml` の job に載せます。載せ忘れと実行権限の付け忘れは `check-repo-policy.sh` が止めます。
5. docs: この文書の「ci.yml の検証」、[開発コマンド](commands.md) の構成とコマンドの表、[Git hook](git-hooks.md) の `pre-commit` の行。
6. 道具や設定を選んだ理由は ADR に書きます。番号は `scripts/check-adr-number.sh` で決めます ([並行作業と worktree](worktrees.md#pr-を出す))。

## スクリプトのテスト

`scripts/test/*.test.sh` は、`scripts/` のスクリプトと `.kiro/hooks/` の hook が、止めるべき入力で止まり、通すべき入力を通すかを確かめます。
`ci.yml` で実行し、`secret-scan.test.sh` は mise で betterleaks を入れた `secret-scan.yml` で実行します。pre-commit hook でも、対象のスクリプトを変えたときに実行します。

テストは一時ディレクトリに git リポジトリを作って操作するので、このリポジトリを触らないように次の規則を守ります。

- テストは `scripts/test/lib.sh` を読み込み、`make_sandbox` で作った `$sandbox` の中だけで git を使います。
- git の操作は `in_sandbox_repo <dir> <command>` を通します。`<dir>` のリポジトリが `$sandbox` の外にあると、実行せずに止まります。
- push と fetch の宛先は、`origin` などの名前ではなく、`$sandbox` の中のパスにします。

`lib.sh` は、git が hook の中で設定する `GIT_DIR`、`GIT_INDEX_FILE` などを消し、`GIT_CEILING_DIRECTORIES` でリポジトリの探索を `$sandbox` で止め、`GIT_ALLOW_PROTOCOL=file` でネットワーク越しの git を禁じます。
これらがないと、pre-commit hook から実行したテストが、このリポジトリに commit して main に push します (2026-10-23 に実際に起きました)。
`isolation.test.sh` は hook と同じ変数を設定して他のテストを実行し、その変数が指すリポジトリが変わらないことを確かめます。
テストが失敗すると、失敗したコマンドの出力の最後の20行を表示します。
