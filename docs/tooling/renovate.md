---
type: Runbook
title: Renovate
description: Renovate の GitHub App のインストール、更新の対象と対象外、Renovate の PR を merge する前の確認、更新を止めるメジャー版を人が上げる手順、設定を変えたときの検査。Renovate の PR が出たとき、Renovate の設定を変えるとき、App をインストールするときに読む。
tags: [tooling, runbook, renovate, mise, github-actions, pnpm]
---

# Renovate

Renovate は、固定した版を更新する PR を出します ([ADR 0016](../adr/0016-renovate-for-pinned-versions))。設定は `renovate.jsonc` です。 PR は squash merge し、タイトルは `chore(deps): ...` です。

## インストール (管理者)

リポジトリの管理者が、[Renovate の GitHub App](https://github.com/apps/renovate) を `yokozi-jp/agent-software-factory` だけに許可してインストールします。 `renovate.jsonc` が default branch にあれば、onboarding の PR は出ず、Renovate は設定のとおりに動き始めます。 動いたかどうかは、`Dependency Dashboard` という issue ができることで分かります。この issue は triage の対象ではありません。

## 更新の対象

| ファイル                                        | 更新するもの                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `mise.toml`、`mise.lock`                        | actionlint、betterleaks、shellcheck、zizmor。Renovate が `mise lock` で `mise.lock` も更新する |
| `.betterleaks.toml`                             | `betterleaksMinVersion`。betterleaks の PR で、`mise.toml` と一緒に更新する                    |
| `.github/workflows/*.yml`                       | Action の commit SHA と、同じ行の `# v1.2.3` のコメント。`jdx/mise-action` の `version`        |
| `pnpm-workspace.yaml`、`pnpm-lock.yaml`         | catalog の依存。nx と vite-plus と tanstack router は monorepo ごとに1つの PR にまとまる       |
| `.node-version`、`package.json` の `devEngines` | Node.js と pnpm のマイナー版とパッチ版                                                         |

`config:best-practices` により、npm のパッケージは公開から3日たつまで PR を出さず、lock file (`mise.lock`、`pnpm-lock.yaml`) は毎週月曜の早朝に更新します。

## 更新しないもの

| 対象                                | 理由                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| betterleaks のメジャー版            | v1 に留める ([ADR 0003](../adr/0003-pin-betterleaks-v1))                                   |
| Node.js、`@types/node` のメジャー版 | Lambda の runtime とそろえる ([ADR 0013](../adr/0013-api-on-ecs-and-lambda-web-functions)) |
| `runs-on` の image (`ubuntu-24.04`) | runner の OS を変えるのは、別の判断                                                        |

## PR を merge する前に

CI (`main`、`commitlint`、`betterleaks`) が通ったことを確かめます。そのうえで、PR ごとに次を見ます。

- **mise の道具**: `mise.toml` と `mise.lock` の両方が変わっていること。`mise.lock` に `linux-x64` 以外の platform が増えていないこと。zizmor や actionlint の版で workflow の指摘が増えたら、同じ PR で直します ([ADR 0012](../adr/0012-lint-workflows))。
- **betterleaks**: `mise.toml`、`mise.lock`、`.betterleaks.toml` の3つが同じ版に変わっていること。`check-repo-policy.sh` が落ちたら、そろっていないファイルを直します。
- **Action**: SHA が変わり、同じ行のコメントの版も変わっていること。リリースノートで権限や入力の変更がないか見ます。
- **catalog**: `pnpm-lock.yaml` が変わっていること。

## 更新を止めたメジャー版を上げる

人が、該当する ADR を見直してから上げます。betterleaks は [ADR 0003](../adr/0003-pin-betterleaks-v1) と [secret scan](secret-scan)、Node.js は [ADR 0013](../adr/0013-api-on-ecs-and-lambda-web-functions) の手順に従います。 上げたあと、`renovate.jsonc` の該当する `packageRules` を消すか、版を変えます。

## 設定を変えたとき

```sh
pnpm dlx --package=renovate renovate-config-validator --strict
```

`re2` のネイティブモジュールを読めないという警告が出ても、検証は完了します。 実際にどの更新が出るかは、`LOG_LEVEL=debug renovate --platform=local` をリポジトリのルートで実行して確かめます。`GITHUB_COM_TOKEN` に GitHub の token を渡します。
