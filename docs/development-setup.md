# 開発環境の構築

このリポジトリで開発を始めるまでの手順と、日常的に使うコマンドをまとめます。
ツールを選んだ理由は [ADR](./adr/) に書いてあります。

## 構成

| 役割                                  | ツール                                               |
| ------------------------------------- | ---------------------------------------------------- |
| モノレポ、タスクの実行と cache        | Nx 24                                                |
| パッケージマネージャ                  | pnpm 12.15.0 (`package.json` の `devEngines` で固定) |
| Node.js                               | 26 (`.node-version` で固定)                          |
| build、test、lint、format、型チェック | Vite+ (`vp`)                                         |
| Git hook                              | lefthook                                             |
| コミットメッセージの検証              | commitlint (Conventional Commits)                    |
| 秘密情報の検出                        | betterleaks 1.9.0                                    |

```
apps/
  api/   Hono (Node.js)。GET /health
  web/   React + TanStack Router
packages/  共有パッケージ (今はなし)
scripts/   hook から呼ぶシェルスクリプト
```

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

### betterleaks 1.9.0

Git hook と CI で秘密情報を検出するために使います。npm パッケージではないので、各自でインストールします。
バージョンは **1.9.0 ちょうど** に揃えてください。違うバージョンだと hook が失敗します (理由は [ADR 0003](./adr/0003-pin-betterleaks-v1.md))。

Homebrew や `go install` は最新版 (v2 系を含む) が入ることがあるので使いません。
GitHub Releases からバイナリを取得し、checksum を確認して `PATH` の通った場所に置きます。

```sh
# macOS / Linux (x64 / arm64)
version=1.9.0
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
command -v betterleaks   # 1.9.0 を置いた場所が表示されること
betterleaks version      # 1.9.0
```

別の場所に古い版や v2 系の betterleaks がある場合は、`PATH` で先に見つかる方が使われます。
`command -v betterleaks` で、1.9.0 を置いた場所が表示されることを確認してください。

Windows は WSL2 上で開発することを推奨します (hook のスクリプトは POSIX sh で書いています)。

## 2. clone とセットアップ

```sh
git clone https://github.com/yokozi-jp/hono-nx-vite-plus.git
cd hono-nx-vite-plus

vp env install   # .node-version の Node.js と、package.json の pnpm をインストール
pnpm install     # 依存をインストールし、prepare スクリプトで lefthook の hook を設定
```

`pnpm install` の最後に `sync hooks: ✔️ (pre-commit, commit-msg, pre-push)` と表示されれば、hook が設定されています。

動作を確認します。

```sh
node -v                 # v26.x
pnpm -v                 # 12.15.0
pnpm exec nx show projects   # api, web
pnpm check && pnpm test && pnpm build
```

## 3. 日常的に使うコマンド

root から実行します。タスクは Nx が実行し、結果を cache します。

| やりたいこと                               | コマンド                                         |
| ------------------------------------------ | ------------------------------------------------ |
| api の開発サーバー (http://localhost:3000) | `pnpm exec nx dev api`                           |
| web の開発サーバー (http://localhost:5173) | `pnpm exec nx dev web`                           |
| 全プロジェクトの lint、format、型チェック  | `pnpm check`                                     |
| 全プロジェクトのテスト                     | `pnpm test`                                      |
| 全プロジェクトの build                     | `pnpm build`                                     |
| 変更の影響を受けるプロジェクトだけ実行     | `pnpm exec nx affected -t check test build`      |
| format と lint の自動修正                  | `pnpm exec vp check --fix`                       |
| 依存の追加 (例: api)                       | `pnpm --filter @hono-nx-vite-plus/api add <pkg>` |

補足:

- `vp run` は使いません。タスクの実行と cache は Nx に統一しています ([ADR 0002](./adr/0002-nx-orchestrates-vite-plus.md))。
- 依存のバージョンは `pnpm-workspace.yaml` の `catalog` で一元管理します (`catalogMode: prefer`)。`pnpm add` すると自動で catalog に追加されます。
- `apps/web/src/routeTree.gen.ts` は TanStack Router が生成するファイルです。手で編集せず、生成された差分を commit します。

## 4. コミット規約

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) に従います。commit-msg hook と CI の commitlint で検証します。

```
<type>(<scope>): <subject>
```

- **type** (必須): `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- **scope** (任意): 書く場合は Nx のプロジェクト名 (`api`, `web`)。複数のプロジェクトにまたがる場合は省略します。
- **subject**: 日本語でも英語でも構いません。
- 破壊的変更は `feat(api)!: ...` のように `!` を付けるか、本文に `BREAKING CHANGE:` を書きます。

例:

```
feat(api): ユーザー登録 API を追加
fix(web): トップページの表示崩れを修正
ci: secret scan のタイムアウトを延長
```

PR は **squash merge だけ** を使います。PR タイトルがそのまま main のコミットメッセージになるので、PR タイトルも同じ規約で書いてください (CI で検証します。[ADR 0004](./adr/0004-squash-merge-and-pr-title-lint.md))。

`feat` と `fix` はリリース時のバージョン決定と CHANGELOG に使われます ([7. リリース](#7-リリース))。

## 5. Git hook

`lefthook.yml` で定義しています。

| hook         | 実行内容                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `commit-msg` | commitlint でコミットメッセージを検証                                                                |
| `pre-commit` | betterleaks で staged の変更を scan。staged ファイルに `vp check --fix` を実行し、修正を自動で stage |
| `pre-push`   | betterleaks で push するコミットの範囲を scan                                                        |

型チェックとテストは hook では実行せず、CI に任せます。

### hook を一時的に飛ばす

```sh
LEFTHOOK=0 git commit ...           # 全 hook を飛ばす
LEFTHOOK_EXCLUDE=check git commit ...   # 特定のコマンドだけ飛ばす
git commit --no-verify ...           # Git 標準の方法
```

飛ばしても CI で同じ検証 (commitlint、betterleaks、check) を実行するので、問題は PR の段階で止まります。
secret scan を飛ばして秘密情報を push してしまった場合は、履歴から消しても既に漏れたものとして扱い、**すぐにその秘密情報を無効化 (rotate)** してください。

### hook が動かないとき

```sh
pnpm exec lefthook install   # hook を設定し直す
pnpm exec lefthook run pre-commit   # hook を手動で実行
```

## 6. secret scan の誤検知への対処

設定は `.betterleaks.toml` です (デフォルトのルールをそのまま使用)。誤検知が出たら、次のどちらかで個別に除外します。

1. **該当行にコメントを付ける** (推奨): 行末に `betterleaks:allow` を書きます。

   ```ts
   const example = "AKIAXXXXXXXXEXAMPLE"; // betterleaks:allow
   ```

2. **`.betterleaksignore` に fingerprint を書く**: コメントを書けないファイル (JSON など) の場合に使います。
   fingerprint は検出結果の `Fingerprint` 欄に表示されます (`<commit>:<file>:<rule>:<line>` の形式)。1行に1つ書きます。

本物の秘密情報だった場合は除外せず、コードから取り除いて環境変数 (`.env`、commit しない) に移し、その秘密情報を無効化してください。
`.env` と `.env.*` は `.gitignore` 済みです。必要な変数の一覧は `.env.example` に書いて commit します。

ローカルで手動で scan する場合:

```sh
scripts/betterleaks.sh git --redact --config .betterleaks.toml .   # 全履歴
scripts/betterleaks.sh dir --redact --config .betterleaks.toml .   # 作業ツリー
```

## 7. リリース

`nx release` で、`api` と `web` に独立したバージョンを付けます。npm には publish しません。

- バージョンは前回のリリースからのコミットで決まります。`fix` は patch、`feat` は minor、破壊的変更は major を上げます。
  ただし `0.x` の間は 1段下がり、`feat` は patch、破壊的変更は minor になります (Nx の `adjustSemverBumpsForZeroMajorVersion`)。
- プロジェクトごとに `apps/<name>/CHANGELOG.md`、git タグ `<name>@<version>`、GitHub Release を作ります。

手順:

1. GitHub の **Actions → Release → Run workflow** を開き、`main` で実行します。
2. まず `dry-run` にチェックを入れたまま実行し、ログで次のバージョンと CHANGELOG を確認します。
3. 問題なければ `dry-run` を外して実行します。初回だけ `first-release` にチェックを入れます (前回のタグがないため)。

ローカルでの確認:

```sh
pnpm exec nx release --dry-run --skip-publish            # 2回目以降
pnpm exec nx release --dry-run --skip-publish --first-release   # 初回
```

Release workflow は `chore: release` コミットとタグを main に直接 push します。
main に branch protection を設定する場合は、`github-actions[bot]` が push できるように bypass を許可してください。

## 8. CI

`.github/workflows/` にあります。全ての Action は commit SHA で固定しています。

| workflow          | 実行タイミング     | 内容                                                       |
| ----------------- | ------------------ | ---------------------------------------------------------- |
| `ci.yml`          | PR、main への push | `nx affected -t check test build`                          |
| `commitlint.yml`  | PR                 | PR タイトルと PR 内の全コミットを検証                      |
| `secret-scan.yml` | PR、main への push | PR は PR のコミットを、main は全履歴を betterleaks で scan |
| `release.yml`     | 手動               | `nx release` (上記)                                        |

betterleaks のバージョンを上げるときは、次の3か所を揃えて変更します。

- `.github/workflows/secret-scan.yml` の `BETTERLEAKS_VERSION` と `BETTERLEAKS_SHA256` (リリースの `checksums.txt` の `linux_x64` の値)
- `scripts/betterleaks.sh` の `REQUIRED_VERSION`
- `.betterleaks.toml` の `betterleaksMinVersion`

## 9. GitHub リポジトリの設定 (管理者が1回だけ実行)

squash merge だけを許可し、squash のコミットタイトルを PR タイトル、本文を PR の説明にします。
本文を残すのは、PR の説明に書いた `BREAKING CHANGE:` をリリースのバージョン決定に使えるようにするためです。

```sh
gh repo edit yokozi-jp/hono-nx-vite-plus \
  --enable-squash-merge \
  --squash-merge-commit-message pr-title-description \
  --enable-merge-commit=false \
  --enable-rebase-merge=false \
  --delete-branch-on-merge
```

main の branch protection (または ruleset) では、次の status check を必須にすることを推奨します。

- `CI / main`
- `Commitlint / commitlint`
- `Secret scan / betterleaks`
