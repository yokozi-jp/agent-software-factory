---
type: ADR
title: "ADR 0008: シェルスクリプトは版を固定した shellcheck で検査する"
description: リポジトリのシェルスクリプトを shellcheck 0.11.0 で検査し、betterleaks と同じく GitHub Releases のバイナリを checksum で検証して hook と CI で同じ版を使う決定。
tags: [adr, tooling, shellcheck, ci]
---

# ADR 0008: シェルスクリプトは版を固定した shellcheck で検査する

`scripts/` と `.kiro/hooks/` のシェルスクリプトは、CI と Git hook とエージェントの hook から呼ばれますが、どの検査もかかっていませんでした。`vp check` (oxlint、oxfmt) は `.sh` を対象にしません。シェルスクリプトの lint には、事実上の標準である shellcheck を使います。

shellcheck は版によって警告の種類が増えるので、版を `.shellcheck-version` (0.11.0) に固定し、ローカルと CI で同じ版を使います。入れ方は ADR 0003 の betterleaks と同じです。各自が GitHub Releases のバイナリを入れ、CI はリリースのバイナリを checksum で検証してから使います。`scripts/shellcheck.sh` は、shellcheck がないときや版が違うときに、検査を飛ばさずに失敗します。

## Considered Options

- **GitHub のランナーに入っている shellcheck**: ubuntu-24.04 のイメージには 0.9.0 が入っています。CI にステップを足すだけで済みますが、版がランナーのイメージの更新で変わり、ローカルの版とずれます。
- **npm の `shellcheck` パッケージ**: `pnpm install` で入りますが、バイナリを実行時にダウンロードするラッパーで、最終リリースは 2025-08 です。

## Consequences

- 検査の対象は、git で管理している `*.sh` のうち `.agents/` の外にあるものです。`.agents/` は upstream からインストールした skill で、内容を変えられないためです。
- 意図して書いた箇所の警告は、理由のコメントを付けて `# shellcheck disable=SCxxxx` で止めます。
- 版を上げるときは、`.shellcheck-version` と、`.github/workflows/ci.yml` の `SHELLCHECK_SHA256` (GitHub のリリースの `linux.x86_64.tar.gz` の digest) を一緒に変えます。
