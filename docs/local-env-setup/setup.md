---
type: Runbook
title: 開発環境の構築
description: clone してから hook が動き、check、test、build が通るまでの手順。新しく開発に参加するとき、マシンを作り直したときに読む。
tags: [setup, runbook, node, pnpm, vite-plus, mise, betterleaks, shellcheck]
---

# 開発環境の構築

前提ツール (Git、Vite+、mise) を入れ、`mise install --locked`、`vp env install`、`pnpm install` を実行すると、betterleaks、shellcheck、Node.js、pnpm、依存、Git hook が揃います。
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

### mise

Git hook と CI で使う betterleaks と shellcheck を、`mise.toml` と `mise.lock` で固定した版で入れるために使います (理由は [ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。
Debian 11 以上と Ubuntu 22.04 以上 (WSL を含む) では、署名された apt リポジトリから入れます。

```sh
sudo apt install -y extrepo
sudo extrepo enable mise
sudo apt update
sudo apt install -y mise
mise --version
```

`extrepo enable mise` が `Could not download index YAML file` で失敗するときは (社内のプロキシで extrepo のデータの取得が TLS の検証に失敗する場合など)、extrepo が書くのと同じ設定を手で書きます。
鍵の fingerprint が `24853EC9F655CE80B48E6C3A8B81C9D17413A06D` であることを確かめてから進みます。これは extrepo のデータ (`salsa.debian.org/extrepo-team/extrepo-data` の `repos/debian/mise.yaml`) に入っている鍵と同じものです。

```sh
sudo install -dm 755 /etc/apt/keyrings
curl -fsSL https://mise.jdx.dev/gpg-key.pub | gpg --dearmor | sudo tee /etc/apt/keyrings/mise-archive-keyring.gpg > /dev/null
gpg --show-keys /etc/apt/keyrings/mise-archive-keyring.gpg   # 24853EC9F655CE80B48E6C3A8B81C9D17413A06D
sudo tee /etc/apt/sources.list.d/mise.sources > /dev/null <<'EOF'
Types: deb
URIs: https://mise.jdx.dev/deb
Suites: stable
Components: main
Architectures: amd64 arm64
Signed-By: /etc/apt/keyrings/mise-archive-keyring.gpg
EOF
cat /etc/apt/sources.list.d/mise.sources   # 6 行で、どの行も空白で始まらないこと
sudo apt update
sudo apt install -y mise
mise --version
```

ほかの OS は [mise の docs](https://mise.jdx.dev/installing-mise.html) を見てください。
hook とスクリプトは `mise exec` で道具を呼ぶので、シェルの設定 (`mise activate`) は要りません。

## 2. clone

```sh
git clone https://github.com/yokozi-jp/hono-nx-vite-plus.git
cd hono-nx-vite-plus
```

## 3. betterleaks と shellcheck

リポジトリの root で実行します。`mise.lock` に記録した版を、記録した checksum で検証してから入れます。betterleaks は、release の署名 (cosign) も検証します。

```sh
mise install --locked
mise exec -- betterleaks version    # mise.toml と同じ版
mise exec -- shellcheck --version   # version: が mise.toml と同じ版
```

`PATH` に別の版の betterleaks や shellcheck があっても、hook と CI は `mise exec` 経由で固定した版を使います。

## 4. 依存のインストール

```sh
vp env install   # .node-version の Node.js と、package.json の pnpm をインストール
pnpm install     # 依存をインストールし、prepare スクリプトで lefthook の hook を設定
```

`pnpm install` の最後に `sync hooks: ✔️ (pre-commit, commit-msg, pre-push)` と表示されれば、hook が設定されています。
IWE (`iwe`、`iwec`) も devDependency として入るので、別途インストールする必要はありません。

## 5. 動作の確認

```sh
node -v                      # v26.x
pnpm -v                      # 12.15.0
pnpm exec nx show projects   # api, web
pnpm check && pnpm test && pnpm build
```
