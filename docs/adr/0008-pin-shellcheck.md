---
type: ADR
title: "ADR 0008: シェルスクリプトは版を固定した shellcheck で検査する"
description: リポジトリのシェルスクリプトを shellcheck 0.11.0 で検査し、betterleaks と同じく mise で固定した版を hook と CI で使う決定。
tags: [adr, tooling, shellcheck, ci]
---

# ADR 0008: シェルスクリプトは版を固定した shellcheck で検査する

`tools/scripts/sh/` (CLI を呼ぶだけの薄いラッパー。[ADR 0024](0024-scripts-and-hooks-in-typescript.md)) と `.kiro/hooks/` のシェルスクリプトは、CI と Git hook とエージェントの hook から呼ばれますが、どの検査もかかっていませんでした。`vp check` (oxlint、oxfmt) は `.sh` を対象にしません。シェルスクリプトの lint には、事実上の標準である shellcheck を使います。

shellcheck は版によって警告の種類が増えるので、版を `mise.toml` (0.11.0) に固定し、ローカルと CI で同じ版を使います。入れ方は betterleaks と同じく mise です ([ADR 0009](0009-mise-for-pinned-cli-tools.md))。`tools/scripts/sh/shellcheck.sh` は `mise exec` で固定した版を呼び、mise がないときは検査を飛ばさずに失敗します。

## Considered Options

- **GitHub のランナーに入っている shellcheck**: ubuntu-24.04 のイメージには 0.9.0 が入っています。CI にステップを足すだけで済みますが、版がランナーのイメージの更新で変わり、ローカルの版とずれます。
- **npm の `shellcheck` パッケージ**: `pnpm install` で入りますが、バイナリを実行時にダウンロードするラッパーで、最終リリースは 2025-08 です。

## Consequences

- 検査の対象は、git で管理している `*.sh` のうち `.agents/` の外にあるもので、今は `tools/scripts/sh/` のラッパーです。`.agents/` は upstream からインストールした skill で、内容を変えられないためです。`tools/scripts/sh/shellcheck.sh` は、この範囲を `tools/scripts/src/sh/shellcheck.test.ts` (stub の mise で渡すファイルを確かめる) と `shellcheck.tools.test.ts` (本物の shellcheck) でテストします。
- 意図して書いた箇所の警告は、理由のコメントを付けて `# shellcheck disable=SCxxxx` で止めます。
- 版を上げるときは、`mise.toml` の版を変えて `mise lock --platform linux-x64` を実行し、`mise.lock` と一緒に commit します。
