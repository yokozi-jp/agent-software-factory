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

- `scripts/check-repo-policy.sh`: ADR の決定を機械的に確認します (`@nx/vite` がない、`vite.config.ts` に `run` がない、`.vite-hooks` がない、betterleaks のバージョンが一致している、ADR の番号が重複していない)。CI は作業ツリーを、pre-commit は `staged` を付けてステージした内容を検査します。ステージしていない他のファイルの編集で、コミットが止まらないようにするためです。
  `docs/` の外 (スクリプト、設定、`AGENTS.md`、workflow) に書いた `docs/...md` のパス、`docs/...md ("見出し")` の見出し、`docs/adr/NNNN` の番号が実在することも確認します。見出しは番号を付けずに書きます。
  `git init`、`git clone`、`git -C`、`--git-dir`、`GIT_DIR=` で別のリポジトリを操作するスクリプトは、`scripts/test/lib.sh` を読み込んだテストの中だけに置けます (理由は「スクリプトのテスト」)。
- `scripts/test/run.sh`: スクリプトと Kiro の hook の動作をテストします ([スクリプトのテスト](#スクリプトのテスト))。
- `scripts/shellcheck.sh`: git で管理しているシェルスクリプト (`.agents/` を除く) を shellcheck で検査します。版は `mise.toml` と `mise.lock` で固定し、CI は `jdx/mise-action` で lock のとおりに入れます ([ADR 0008](../adr/0008-pin-shellcheck.md)、[ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。
- `scripts/lint-workflows.sh`: git で管理している `.github/workflows/` の workflow を actionlint と zizmor で検査します ([ADR 0012](../adr/0012-lint-workflows.md))。actionlint は構文、式の型、参照の誤りを、zizmor は script injection、過大な権限、`persist-credentials` の書き忘れなどを見つけます。actionlint は `run:` のスクリプトも固定した shellcheck で検査します。
  zizmor は `--offline` で動かすので、GitHub API を使う audit は実行しません ([zizmor の Usage](https://docs.zizmor.sh/usage/))。版は shellcheck と同じく mise で固定します。指摘を抑制するときは、その場所に理由を書きます (`# zizmor: ignore[<audit>]`、`# shellcheck disable=SCxxxx`)。
- `scripts/verify-skills-lock.mjs`: `.agents/skills` が `skills-lock.json` の記録と一致し、`.kiro/skills` に各 skill への symlink があることを確認します。skill は upstream からインストールしたものなので、手で編集しません。
- `pnpm lint:md`: 全ての Markdown を markdownlint-cli2 で検査します。
- `scripts/docs-check.sh`: `docs/` を OKF v0.2 バンドルとして検査します ([docs の書き方](../knowledge/documentation-authoring.md))。CI は `staged` を付けずに実行するので、`about.md` の記録の検査は pre-commit だけで行います。
- `pnpm check:root` (`scripts/check-root-files.sh`): `apps/`、`packages/`、`tools/` の外にあるファイル (ルートの設定ファイル、`scripts/`、`docs/`、`.github/` など) に `vp check` を実行します。
  各プロジェクトの `check` は Nx のプロジェクトの中のファイルしか見ないので、これらのファイルはこのステップで検査します。
  対象は `git ls-files` で選ぶので、commit していない作業用のファイルは検査しません。
  pre-commit hook では、ステージしたファイルに `vp check --fix` を実行します。
- build の後に `git status` が空であること: `routeTree.gen.ts` などの生成ファイルを commit し忘れると失敗します。

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
