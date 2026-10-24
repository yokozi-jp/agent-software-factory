---
type: Runbook
title: 開発環境の構築
description: Windows 11 の WSL2 (Ubuntu 26.04) に、clone してから hook が動き、check、test、build が通るまでの環境を作る手順。新しく開発に参加するとき、マシンを作り直したときに読む。
tags:
  [
    setup,
    runbook,
    wsl,
    docker,
    github-cli,
    node,
    pnpm,
    vite-plus,
    mise,
    betterleaks,
    shellcheck,
    actionlint,
    zizmor,
  ]
---

# 開発環境の構築

Windows 側で WSL2 のメモリ上限を設定して Ubuntu を作り、Ubuntu 側で2つのコマンドのブロックを貼り付けて実行します。
1つ目のブロックが apt のパッケージ、GitHub CLI、mise、Vite+、Git の設定を入れ、2つ目のブロックが GitHub の認証、clone、依存のインストールをして `pnpm check && pnpm test && pnpm build` まで実行します。
日常のコマンドは [開発コマンド](../tooling/commands.md) にあります。

## 前提

- Windows 11 (物理メモリ 32GB を想定)
- [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)
- [Visual Studio Code](https://code.visualstudio.com/) と、その [WSL 拡張機能](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl)

hook のスクリプトは POSIX sh で書いているので、Windows では WSL2 上で開発します。
macOS やネイティブの Linux では、3 と 4 のコマンドを各ツールの docs の手順に読み替えてください。

## 1. WSL2 のメモリ上限と Ubuntu (Windows 側)

WSL2 の VM の既定の上限は次のとおりです ([Microsoft の docs](https://learn.microsoft.com/windows/wsl/wsl-config#main-wsl-settings))。
Docker Desktop のコンテナも同じ VM で動くので、この上限を分け合います。

| 設定         | 既定値                           |
| ------------ | -------------------------------- |
| `memory`     | Windows の物理メモリの 50%       |
| `processors` | Windows の論理プロセッサ数と同じ |

`processors` は既定で全部使えるので、`memory` だけを `%USERPROFILE%\.wslconfig` で引き上げます。
Docker Desktop を終了してから、PowerShell で次を実行します。

```powershell
$memory = '24GB'   # 物理メモリ 32GB の場合。16GB なら 12GB 程度
$distro = 'dev'    # WSL のインスタンス名。用途に合わせて変えてよい
$config = "$env:USERPROFILE\.wslconfig"
if (Test-Path $config) {
  Write-Warning "$config は既にあります。[wsl2] の memory を手で $memory にしてください。"
} else {
  [IO.File]::WriteAllText($config, "[wsl2]`r`nmemory=$memory`r`n")   # UTF-8 (BOM なし) で書く
}
wsl --shutdown                                # 設定は VM の起動時に読まれるため、動いている VM を止める
wsl --install Ubuntu-26.04 --name $distro
```

`.wslconfig` は UTF-8 (BOM なし) で保存します。
Windows PowerShell 5.1 の `Out-File` は UTF-16、`Set-Content -Encoding UTF8` は BOM 付きで書くので、上のコマンドは `[IO.File]::WriteAllText` を使っています。
既にあるファイルをメモ帳で直すときは、「名前を付けて保存」でエンコードに「UTF-8」を選びます。

インストールが終わると Ubuntu が起動するので、ユーザー名とパスワードを設定します。
この Ubuntu のターミナルは 3 で使うので、開いたままにします。

## 2. Docker Desktop の WSL Integration

1. Docker Desktop を起動します。
2. Settings > Resources > WSL Integration を開きます。
3. 1 で作ったインスタンス (`dev`) を有効にします。
4. Apply & Restart をクリックします。

## 3. Ubuntu の初期セットアップ

Ubuntu のターミナルに次のブロックを貼り付けます。
最初に Git の名前とメールアドレスを聞かれ、`sudo` のパスワードを1回聞かれます。

```sh
(
set -euo pipefail
read -rp 'Git の user.name: ' git_name
read -rp 'Git の user.email: ' git_email

# 共通ワークスペース
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 755 /home/projects

# 基本パッケージ。libatomic1 は Node 26 の公式バイナリが、extrepo は mise の apt リポジトリの登録が使う
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl git wget unzip jq vim tree gnupg2 software-properties-common libatomic1 extrepo

# GitHub CLI の apt リポジトリ (公式の手順と同じ鍵と URL)
out=$(mktemp)
wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg
sudo install -D -m 644 "$out" /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null

# mise の apt リポジトリ (トラブルシューティングの手順で登録済みなら飛ばす)
compgen -G '/etc/apt/sources.list.d/*mise.sources' > /dev/null || sudo extrepo enable mise

sudo apt update
sudo apt install -y gh mise

# Git
git config --global user.name "$git_name"
git config --global user.email "$git_email"
git config --global core.autocrlf input
git config --global core.fileMode true
git config --global core.symlinks true
git config --global alias.logs "log --pretty='format:%C(yellow)%h %C(green)%cd %C(cyan)%an %C(reset)%s %C(magenta)%d' --date=format:'%Y-%m-%d %H:%M:%S' --graph"

# Vite+ (vp)。Node.js と pnpm を Vite+ に管理させ、インストーラーの質問を飛ばす
curl -fsSL https://vite.plus | VP_NODE_MANAGER=yes VP_PM_MANAGER=yes bash
)
```

各ツールを入れる理由は次のとおりです。

- Vite+ (`vp`) は Node.js と pnpm を `.node-version` と `package.json` に合わせて用意するので、Node.js と pnpm を別に入れる必要はありません。
- mise は、Git hook と CI で使う CLI ツール (`mise.toml` の `[tools]`) を、`mise.toml` と `mise.lock` で固定した版で入れます ([ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。hook とスクリプトは `mise exec` で道具を呼ぶので、`mise activate` は要りません。
- GitHub CLI (`gh`) は、Git の HTTPS の認証と、Issue や PR の操作に使います。

途中で失敗すると、そこでブロックが止まります。原因を直してから、同じブロックをもう一度貼り付けます (何度実行しても同じ結果になります)。

## 4. GitHub の認証と、リポジトリのセットアップ

Vite+ を `PATH` に入れるために、Ubuntu のターミナルを開き直してから、次のブロックを貼り付けます。

```sh
(
set -euo pipefail
gh auth status > /dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git   # Git の HTTPS の認証を gh に任せる

cd /home/projects
[ -d agent-software-factory ] || git clone https://github.com/yokozi-jp/agent-software-factory.git
cd agent-software-factory

mise install --locked   # mise.toml の道具を、mise.lock の版と checksum で検証して入れる (actionlint の非推奨の警告は docs/adr/0012)
vp env install          # .node-version の Node.js と、package.json の pnpm
pnpm install            # 依存と、prepare スクリプトで lefthook の hook

mise ls --current --missing         # 何も表示しない (mise.toml の道具がすべて入っている)
node -v                             # v26.x
pnpm -v                             # 12.15.0
pnpm exec nx show projects          # api, web
pnpm check && pnpm test && pnpm build
)
cd /home/projects/agent-software-factory
```

`gh auth login` は、ワンタイムコードと URL を表示します。
ブラウザが開かないときは、表示された URL を Windows のブラウザで開き、コードを入力して認証します。
「Authenticate Git with your GitHub credentials?」と聞かれたら Yes を選びます。

次の表示が出れば完了です。

- `pnpm install` の最後の `sync hooks: ✔️ (pre-commit, commit-msg, pre-push)` (hook が設定された)
- `pnpm check`、`pnpm test`、`pnpm build` がエラーなしで終わる

IWE (`iwe`、`iwec`) は devDependency として入るので、別に入れる必要はありません。
`PATH` に別の版の同じ道具があっても、hook と CI は `mise exec` 経由で `mise.toml` の版を使います。

## 5. VS Code で開く

Ubuntu のターミナルで、リポジトリの root から VS Code を開きます。

```sh
code .
```

## トラブルシューティング

### `extrepo enable mise` が `Could not download index YAML file` で失敗する

社内のプロキシで、extrepo のデータの取得が TLS の検証に失敗する場合などに起きます。
extrepo が書くのと同じ設定を手で書いてから、3 のブロックをもう一度実行します。
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
```

### `node` が `libatomic.so.1` で起動しない

Node 26 の公式バイナリは `libatomic.so.1` を必要とします。
`error while loading shared libraries: libatomic.so.1` と出るときは、`sudo apt install -y libatomic1` を実行します (3 のブロックでは入ります)。
