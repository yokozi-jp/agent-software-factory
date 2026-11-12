---
type: Runbook
title: Renovate
description: Renovate の GitHub App のインストール、更新の対象と対象外、Renovate の PR を merge する前の確認、更新を止めるメジャー版を人が上げる手順、設定を変えたときの検査。Renovate の PR が出たとき、Renovate の設定を変えるとき、App をインストールするときに読む。
tags: [tooling, runbook, renovate, mise, github-actions, pnpm]
---

# Renovate

Renovate は、固定した版を更新する PR を出します ([ADR 0018](../adr/0018-renovate-for-pinned-versions.md))。設定は `renovate.jsonc` です。
PR は squash merge し、タイトルは `chore(deps): ...` です。必須チェックが通った PR の一部は、Renovate が自分で merge します ([ADR 0055](../adr/0055-renovate-automerge-by-ci.md))。

## 自動で merge するもの

GitHub の auto-merge で、必須チェック (`main`、`commitlint`、`betterleaks`、`dependency-review`) が通ったら Renovate が merge します。PR の本文に `Automerge: Enabled` と出ます。リポジトリの設定「Allow auto-merge」が要ります ([GitHub リポジトリの設定](../repository/github-settings.md))。

| 自動にする                                                | 条件                                         |
| --------------------------------------------------------- | -------------------------------------------- |
| lock file の更新                                          | なし                                         |
| npm (catalog) の minor と patch                           | 現在の版が 1.0 以上。公開から 3 日たっている |
| GitHub Action と mise の道具の patch (betterleaks を含む) | 公開から 3 日たっている                      |

人が merge する PR: メジャー版、0.x、`better-auth`、`oidc-provider`、Node.js、pnpm、`kiro-cli`、`renovate.sh` が使う Renovate 自身、effect-tsgo と Vite+ の PR、Action と mise の道具の minor、docker のタグ。

自動にする PR で CI が落ちたら、PR は open のまま残ります。直して push すれば、CI が通った時点で merge されます。自動にした PR が main を壊したら、その PR を revert します。止めたいときは、`renovate.jsonc` の自動にする規則を消すか、`gh repo edit --enable-auto-merge=false` を実行します。
本文が `Automerge: Disabled by config` なら、規則が効いていません。

## インストール (管理者)

リポジトリの管理者が、[Renovate の GitHub App](https://github.com/apps/renovate) を `yokozi-jp/agent-software-factory` だけに許可してインストールします。
`renovate.jsonc` が default branch にあれば、onboarding の PR は出ず、Renovate は設定のとおりに動き始めます。
動いたかどうかは、`Dependency Dashboard` という issue ができることで分かります。この issue は triage の対象ではありません。

## 更新の対象

| ファイル                                        | 更新するもの                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mise.toml`、`mise.lock`                        | jactionlint、betterleaks、shellcheck、zizmor。Renovate が `mise lock` で `mise.lock` も更新する                                                                      |
| `mise.toml` の `[tools."http:kiro-cli"]`        | `version`。regex manager が Kiro 公式の `index.json` から検出する ([ADR 0057](../adr/0057-kiro-cli-through-mise-http-backend.md))。branch は `renovate/kiro-cli-3.x` |
| `.betterleaks.toml`                             | `betterleaksMinVersion`。betterleaks の PR で、`mise.toml` と一緒に更新する                                                                                          |
| `.github/workflows/*.yml`                       | Action の commit SHA と、同じ行の `# v1.2.3` のコメント。`jdx/mise-action` の `version`                                                                              |
| `pnpm-workspace.yaml`、`pnpm-lock.yaml`         | catalog の依存。nx と vite-plus と tanstack router は monorepo ごとに1つの PR にまとまる                                                                             |
| `.node-version`、`package.json` の `devEngines` | Node.js (メジャー版を除く) と pnpm                                                                                                                                   |
| `tools/scripts/sh/renovate.sh`                  | `renovate_version`。`renovate.jsonc` の検査に使う Renovate の版。週に1回、月曜の早朝に更新する                                                                       |

`config:best-practices` により、npm のパッケージは公開から3日たつまで PR を出しません。
lock file (`pnpm-lock.yaml`、`mise.lock`) は、毎週月曜の早朝に更新します。`mise.toml` の版は固定しているので、`mise.lock` の週次の更新では版が変わりません。
`pypi:semgrep` の sidecar (`.mise/locks/pypi-semgrep/<版>/uv.lock`) は、`mise.toml` の `[settings] minimum_release_age` を固定日時にしていないと、`mise lock` のたびに `exclude-newer` が `now-24h` で焼き直され、版を固定していても digest が毎週変わり、lock file maintenance の PR が繰り返し出ます ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))。この PR が semgrep の sidecar と `mise.lock` の digest だけを変えて何度も作られるときは、`minimum_release_age` が固定日時であることを確かめます。

## 更新しないもの

| 対象                                | 理由                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| betterleaks のメジャー版            | v1 に留める ([ADR 0003](../adr/0003-pin-betterleaks-v1.md))                                   |
| Node.js、`@types/node` のメジャー版 | Lambda の runtime とそろえる ([ADR 0013](../adr/0013-api-on-ecs-and-lambda-web-functions.md)) |
| `runs-on` の image (`ubuntu-26.04`) | runner の OS を変えるのは、別の判断                                                           |
| nx と `@nx/devkit` の minimatch     | `10.2.5` に戻す (下記)                                                                        |

`pnpm-workspace.yaml` の `overrides` は、Dependabot の alert の推移的依存を修正版以上に引き上げます ([PR #661](https://github.com/yokozi-jp/agent-software-factory/pull/661))。minimatch の修正版 (GHSA-g3hv-75wg-m249) は 11.0.1 だけです。nx 24.0.5 は minimatch を `10.2.5` に固定し、11 にない `minimatch.makeRe` を呼ぶので、11 に上げると `nx show projects --projects` が `makeRe is not a function` で落ち、CI の merged-coverage が止まりました。そこで `nx>minimatch` と `@nx/devkit>minimatch` だけを `10.2.5` に戻しています。nx が読む glob はリポジトリの設定から来て、外の入力ではないので、この alert の影響は受け入れます (判断)。nx の更新の PR では、`pnpm view nx@<版> dependencies.minimatch` が 11 以上になっていたら、この 2 行を消します。
Renovate は open の alert を読んでセキュリティ更新の PR を作るので、この 2 つを 11 に上げる PR を作りました (#668、#669)。`renovate.jsonc` の `packageRules` で `nx>minimatch` と `@nx/devkit>minimatch` を `enabled: false` にして止めています。override の 2 行を消すときは、この規則も消します。

## PR を merge する前に

人が merge する PR (自動にしないもの) の手順です。CI (`main`、`commitlint`、`betterleaks`、`dependency-review`) が通ったことを確かめます。そのうえで、PR ごとに次を見ます。

- **mise の道具**: `mise.toml` と `mise.lock` の両方が変わっていること。`mise.lock` が変わっていない PR は、Renovate が `mise lock` を実行できなかったので、そのブランチで `mise lock --platform linux-x64` を実行して commit します (CI は `MISE_LOCKED=1` で落ちます)。`mise.lock` に `linux-x64` 以外の platform が増えると、repo-policy が落ちます ([ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。zizmor や jactionlint の版で workflow の指摘が増えたら、同じ PR で直します ([ADR 0012](../adr/0012-lint-workflows.md))。
- **kiro-cli**: `mise.toml` の `version` だけが変わります。Renovate が `mise.lock` を更新していなければ、そのブランチで `mise lock http:kiro-cli --platform linux-x64` を実行して commit します (CI は `MISE_LOCKED=1` で落ちます)。`mise.lock` の sha256 が、Kiro 公式の `https://prod.download.cli.kiro.dev/stable/index.json` のその版の値と同じことを確かめ、リリースノートを読んでから merge します ([ADR 0057](../adr/0057-kiro-cli-through-mise-http-backend.md))。
- **betterleaks**: `mise.toml`、`mise.lock`、`.betterleaks.toml` の3つが同じ版に変わっていること。repo-policy (`tools/scripts/src/checks/repo-policy/cli.ts`) が落ちたら、そろっていないファイルを直します。 `mise.toml` に `betterleaks = "v1.10.0"` と v 付きで書かれていたら、`renovate.jsonc` の `extractVersion` の規則が効いていません (PR #621 で起きた。リリースの tag が `v1.10.0` で、`.betterleaks.toml` の `1.10.0` と一致しなかった)。
- **Action**: SHA が変わり、同じ行のコメントの版も変わっていること。リリースノートで権限や入力の変更がないか見ます。
- **catalog**: `pnpm-lock.yaml` が変わっていること。

## 更新を止めたメジャー版を上げる

人が、該当する ADR を見直してから上げます。betterleaks は [ADR 0003](../adr/0003-pin-betterleaks-v1.md) と [secret scan](secret-scan.md)、Node.js は [ADR 0013](../adr/0013-api-on-ecs-and-lambda-web-functions.md) の手順に従います。
上げたあと、`renovate.jsonc` の該当する `packageRules` を消すか、版を変えます。

## 設定を変えたとき

`renovate.jsonc` と `tools/scripts/sh/renovate.sh` を変えた commit では、pre-commit hook が `tools/scripts/sh/renovate.sh validate` を実行します。CI も同じコマンドを実行します。
`validate` は `renovate-config-validator --strict` で、知らない設定項目や不正な値を拒否します。実行する Renovate の版は `tools/scripts/sh/renovate.sh` の `renovate_version` に固定してあり、Renovate が週に1回の PR で上げます。どちらも `pnpm dlx` でその版を取るので、ネットワークが要ります。

実際にどの PR が出るかは、`preview` で確かめます。

```sh
tools/scripts/sh/renovate.sh preview
```

`--platform=local` で Renovate を動かし、出るはずのブランチ名、PR のタイトル、`automerge: yes` か `no` (yes には待つ公開からの日数)、依存ごとの `現在の版 -> 新しい版` を表示します。GitHub の rate limit を避けるため、`GITHUB_COM_TOKEN` か、ログイン済みの `gh` を使います。
Renovate のログは 500 MB を超えることがあるので、`preview` は 1 行ずつ読み、ブランチの一覧の行だけを取り出します。
設定を変えたあとは、意図した PR が出て、止めたはずの更新 (betterleaks の v2 など) が出ないことを見ます。

エージェントは、トークンを読む処理を `renovate.sh` に任せ、`gh auth token` を自分で実行しません。トークンを読む自前のスクリプトも書きません ([エージェントの権限](agent-permissions.md))。`renovate.sh preview` が rate limit で止まったら、利用者に `GITHUB_COM_TOKEN` を設定して実行するよう頼みます。

`renovate.sh` は `pnpm dlx --allow-build=re2` で Renovate を動かします。`pnpm dlx` は、許可のない依存の install スクリプトを実行しないので、この指定がないと `re2` のネイティブモジュール (`build/Release/re2.node`) が作られず、`RE2 not usable` という警告が出ます。そのとき Renovate は `RegExp` で正規表現を検証するので、RE2 が受け付けない構文を見逃します。`re2` はビルド済みのバイナリを GitHub Releases から取ります。
`validate` は、スクリプトが Renovate を動かせることまでしか確かめません。`mise lock` で `mise.lock` が更新されることなど、PR を作る段階の動作は、App をインストールしたあとの最初の PR で確かめます。
