---
type: Runbook
title: Renovate
description: Renovate の GitHub App のインストール、更新の対象と対象外、Renovate の PR を merge する前の確認、更新を止めるメジャー版を人が上げる手順、設定を変えたときの検査。Renovate の PR が出たとき、Renovate の設定を変えるとき、App をインストールするときに読む。
tags: [tooling, runbook, renovate, mise, github-actions, pnpm]
---

# Renovate

Renovate は、固定した版を更新する PR を出します ([ADR 0018](../adr/0018-renovate-for-pinned-versions.md))。設定は `renovate.jsonc` です。
PR は squash merge し、タイトルは `chore(deps): ...` です。

## インストール (管理者)

リポジトリの管理者が、[Renovate の GitHub App](https://github.com/apps/renovate) を `yokozi-jp/agent-software-factory` だけに許可してインストールします。
`renovate.jsonc` が default branch にあれば、onboarding の PR は出ず、Renovate は設定のとおりに動き始めます。
動いたかどうかは、`Dependency Dashboard` という issue ができることで分かります。この issue は triage の対象ではありません。

## 更新の対象

| ファイル                                        | 更新するもの                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `mise.toml`、`mise.lock`                        | jactionlint、betterleaks、shellcheck、zizmor。Renovate が `mise lock` で `mise.lock` も更新する |
| `.betterleaks.toml`                             | `betterleaksMinVersion`。betterleaks の PR で、`mise.toml` と一緒に更新する                     |
| `.github/workflows/*.yml`                       | Action の commit SHA と、同じ行の `# v1.2.3` のコメント。`jdx/mise-action` の `version`         |
| `pnpm-workspace.yaml`、`pnpm-lock.yaml`         | catalog の依存。nx と vite-plus と tanstack router は monorepo ごとに1つの PR にまとまる        |
| `.node-version`、`package.json` の `devEngines` | Node.js (メジャー版を除く) と pnpm                                                              |
| `scripts/renovate.sh`                           | `renovate_version`。`renovate.jsonc` の検査に使う Renovate の版。週に1回、月曜の早朝に更新する  |

`config:best-practices` により、npm のパッケージは公開から3日たつまで PR を出しません。
lock file (`pnpm-lock.yaml`、`mise.lock`) は、毎週月曜の早朝に更新します。`mise.toml` の版は固定しているので、`mise.lock` の週次の更新では版が変わりません。
`pypi:semgrep` の sidecar (`.mise/locks/pypi-semgrep/.../uv.lock`) は、`mise.toml` の `[settings] minimum_release_age` を固定日時にしていないと、`mise lock` のたびに `exclude-newer` が `now-24h` で焼き直され、版を固定していても digest が毎週変わり、lock file maintenance の PR が繰り返し出ます ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))。この PR が semgrep の sidecar と `mise.lock` の digest だけを変えて何度も作られるときは、`minimum_release_age` が固定日時であることを確かめます。

## 更新しないもの

| 対象                                | 理由                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| betterleaks のメジャー版            | v1 に留める ([ADR 0003](../adr/0003-pin-betterleaks-v1.md))                                   |
| Node.js、`@types/node` のメジャー版 | Lambda の runtime とそろえる ([ADR 0013](../adr/0013-api-on-ecs-and-lambda-web-functions.md)) |
| `runs-on` の image (`ubuntu-26.04`) | runner の OS を変えるのは、別の判断                                                           |

## PR を merge する前に

CI (`main`、`commitlint`、`betterleaks`) が通ったことを確かめます。そのうえで、PR ごとに次を見ます。

- **mise の道具**: `mise.toml` と `mise.lock` の両方が変わっていること。`mise.lock` が変わっていない PR は、Renovate が `mise lock` を実行できなかったので、そのブランチで `mise lock --platform linux-x64` を実行して commit します (CI は `MISE_LOCKED=1` で落ちます)。`mise.lock` に `linux-x64` 以外の platform が増えていないこと。zizmor や jactionlint の版で workflow の指摘が増えたら、同じ PR で直します ([ADR 0012](../adr/0012-lint-workflows.md))。
- **betterleaks**: `mise.toml`、`mise.lock`、`.betterleaks.toml` の3つが同じ版に変わっていること。`check-repo-policy.sh` が落ちたら、そろっていないファイルを直します。
- **Action**: SHA が変わり、同じ行のコメントの版も変わっていること。リリースノートで権限や入力の変更がないか見ます。
- **catalog**: `pnpm-lock.yaml` が変わっていること。

## 更新を止めたメジャー版を上げる

人が、該当する ADR を見直してから上げます。betterleaks は [ADR 0003](../adr/0003-pin-betterleaks-v1.md) と [secret scan](secret-scan.md)、Node.js は [ADR 0013](../adr/0013-api-on-ecs-and-lambda-web-functions.md) の手順に従います。
上げたあと、`renovate.jsonc` の該当する `packageRules` を消すか、版を変えます。

## 設定を変えたとき

`renovate.jsonc` と `scripts/renovate.sh` を変えた commit では、pre-commit hook が `scripts/renovate.sh validate` を実行します。CI も同じコマンドを実行します。
`validate` は `renovate-config-validator --strict` で、知らない設定項目や不正な値を拒否します。実行する Renovate の版は `scripts/renovate.sh` の `renovate_version` に固定してあり、Renovate が週に1回の PR で上げます。どちらも `pnpm dlx` でその版を取るので、ネットワークが要ります。

実際にどの PR が出るかは、`preview` で確かめます。

```sh
scripts/renovate.sh preview
```

`--platform=local` で Renovate を動かし、出るはずのブランチ名、PR のタイトル、依存ごとの `現在の版 -> 新しい版` を表示します。GitHub の rate limit を避けるため、`GITHUB_COM_TOKEN` か、ログイン済みの `gh` を使います。
設定を変えたあとは、意図した PR が出て、止めたはずの更新 (betterleaks の v2 など) が出ないことを見ます。

`re2` のネイティブモジュールを読めないという警告が出ても、検証は完了します。
`validate` は、スクリプトが Renovate を動かせることまでしか確かめません。`mise lock` で `mise.lock` が更新されることなど、PR を作る段階の動作は、App をインストールしたあとの最初の PR で確かめます。
