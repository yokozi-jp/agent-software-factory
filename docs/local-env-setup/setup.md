---
type: Runbook
title: 開発環境の構築
description: clone してから hook が動き、check、test、build が通るまでの手順。新しく開発に参加するとき、マシンを作り直したときに読む。
tags: [setup, runbook, node, pnpm, vite-plus, betterleaks, shellcheck]
---

# 開発環境の構築

前提ツール (Git、Vite+、betterleaks、shellcheck) を入れ、`vp env install` と `pnpm install` を実行すると、Node.js、pnpm、依存、Git hook が揃います。
最後に `pnpm check && pnpm test && pnpm build` が通れば完了です。
日常のコマンドは [開発コマンド](../tooling/commands.md) にあります。

## 1. 前提ツールのインストール

### Git

2.32 以上が必要です (lefthook と `vp check` の要件)。

```sh
git --version
```

### Linux の場合: libatomic

Node 26 の公式バイナリは `libatomic.so.1` を必要とします。入っていないと `node` が
`error while loading shared libraries: libatomic.so.1` で起動しません。

```sh
# Debian / Ubuntu
sudo apt install libatomic1
# Fedora / RHEL
sudo dnf install libatomic
```

### Vite+ (`vp`)

`vp` が Node.js と pnpm を `.node-version` と `package.json` に合わせて用意します。
Node.js と pnpm を別途インストールする必要はありません。

```sh
# macOS / Linux
curl -fsSL https://vite.plus | bash
```

```powershell
# Windows (PowerShell)
irm https://vite.plus/ps1 | iex
```

インストール後に新しいシェルを開き、`~/.vite-plus/bin` が `PATH` に入っていることを確認します。

```sh
vp --version
```

Windows は WSL2 上で開発することを推奨します (hook のスクリプトは POSIX sh で書いています)。

## 2. clone

```sh
git clone https://github.com/yokozi-jp/hono-nx-vite-plus.git
cd hono-nx-vite-plus
```

## 3. betterleaks

Git hook と CI で秘密情報を検出するために使います。npm パッケージではないので、各自でインストールします。
バージョンは `.betterleaks-version` に書いたものに **ちょうど** 揃えてください。違うバージョンだと hook が失敗します (理由は [ADR 0003](../adr/0003-pin-betterleaks-v1.md))。

Homebrew や `go install` は最新版 (v2 系を含む) が入ることがあるので使いません。
GitHub Releases からバイナリを取得し、checksum を確認して `PATH` の通った場所に置きます。リポジトリの root で実行します。

```sh
# macOS / Linux (x64 / arm64)
version=$(cat .betterleaks-version)
os=$(uname -s | tr '[:upper:]' '[:lower:]')            # linux / darwin
arch=$(uname -m); case "$arch" in x86_64) arch=x64;; aarch64) arch=arm64;; esac
archive="betterleaks_${version}_${os}_${arch}.tar.gz"
base="https://github.com/betterleaks/betterleaks/releases/download/v${version}"

tmp=$(mktemp -d) && cd "$tmp"
curl -sSfLO "$base/$archive"
curl -sSfLO "$base/checksums.txt"
# Linux: sha256sum / macOS: shasum -a 256
grep " $archive\$" checksums.txt | (sha256sum -c - 2>/dev/null || shasum -a 256 -c -)
tar -xzf "$archive" betterleaks
mkdir -p ~/.local/bin && install -m 0755 betterleaks ~/.local/bin/betterleaks
cd - && rm -rf "$tmp"
```

`~/.local/bin` が `PATH` に入っていない場合は、シェルの設定ファイルに追加してください。
確認します。

```sh
command -v betterleaks   # いま置いた ~/.local/bin/betterleaks が表示されること
betterleaks version      # .betterleaks-version と同じ値
```

別の場所に古い版や v2 系の betterleaks がある場合は、`PATH` で先に見つかる方が使われます。

## 4. shellcheck

Git hook と CI でシェルスクリプトを検査するために使います。betterleaks と同じく、バージョンは `.shellcheck-version` に書いたものに **ちょうど** 揃えます (理由は [ADR 0008](../adr/0008-pin-shellcheck.md))。
apt や Homebrew で入る版は固定できないので、GitHub Releases からバイナリを取得し、checksum を確認して置きます。リポジトリの root で実行します。

```sh
# macOS / Linux (x86_64 / aarch64)
version=$(cat .shellcheck-version)
os=$(uname -s | tr '[:upper:]' '[:lower:]')            # linux / darwin
arch=$(uname -m); case "$arch" in arm64) arch=aarch64;; esac
archive="shellcheck-v${version}.${os}.${arch}.tar.gz"

tmp=$(mktemp -d) && cd "$tmp"
curl -sSfLO "https://github.com/koalaman/shellcheck/releases/download/v${version}/${archive}"
# GitHub のリリースページの digest (sha256) と一致すること
sha256sum "$archive" 2>/dev/null || shasum -a 256 "$archive"
tar -xzf "$archive"
mkdir -p ~/.local/bin && install -m 0755 "shellcheck-v${version}/shellcheck" ~/.local/bin/shellcheck
cd - && rm -rf "$tmp"
```

確認します。

```sh
command -v shellcheck    # いま置いた ~/.local/bin/shellcheck が表示されること
shellcheck --version     # version: が .shellcheck-version と同じ値
```

## 5. 依存のインストール

```sh
vp env install   # .node-version の Node.js と、package.json の pnpm をインストール
pnpm install     # 依存をインストールし、prepare スクリプトで lefthook の hook を設定
```

`pnpm install` の最後に `sync hooks: ✔️ (pre-commit, commit-msg, pre-push)` と表示されれば、hook が設定されています。
IWE (`iwe`、`iwec`) も devDependency として入るので、別途インストールする必要はありません。

## 6. 動作の確認

```sh
node -v                      # v26.x
pnpm -v                      # 12.15.0
pnpm exec nx show projects   # api, web
pnpm check && pnpm test && pnpm build
```
