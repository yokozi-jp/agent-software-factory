---
type: ADR
title: "ADR 0016: 固定した版の更新は Renovate に任せる"
description: mise.toml と mise.lock、GitHub Actions の commit SHA、pnpm-workspace.yaml の catalog に固定した版を、Renovate の GitHub App が更新する PR で上げる決定。betterleaks の v2、Node.js のメジャー版、runs-on の image は更新させない。Renovate の設定や対象を変えるとき、Renovate の PR が想定と違うとき、Dependabot や手作業に戻したくなったときに読む。
tags: [adr, tooling, renovate, mise, security]
---

# ADR 0016: 固定した版の更新は Renovate に任せる

このリポジトリは、CLI ツール (`mise.toml` と `mise.lock`、[ADR 0009](0009-mise-for-pinned-cli-tools))、GitHub Actions (commit SHA)、npm のパッケージ (`pnpm-workspace.yaml` の catalog) の版を固定しています。固定した版は人が手で上げていたので、上げ忘れると古い版が残ります。OpenSSF Scorecard の Pinned-Dependencies も、依存を固定するなら自動更新のツールと組み合わせるよう求めています (`ossf/scorecard` の `docs/checks.md`)。そこで Mend の Renovate GitHub App を入れ、設定を `renovate.jsonc` に置いて、更新を PR として出させます。プリセットは `config:best-practices` です (Renovate が推奨する設定で、GitHub Actions の SHA 固定、npm の公開から3日待つ `minimumReleaseAge`、lock file の週次更新を含みます)。

Renovate 44.181.1 を `--platform=local` で動かし、`mise.toml` の4つの道具、4つの workflow の Action と `jdx/mise-action` の `version`、catalog の依存、`.node-version` を検出して更新を見つけることを確かめました。

## Considered Options

- **Dependabot**: GitHub 標準で、Action と npm は扱えます。ただし GitHub の docs の「Dependabot supported ecosystems」には mise がなく、`mise.toml` と `mise.lock` を更新できません (2026-10 時点)。
- **自分で動かす Renovate (GitHub Actions の workflow)**: 更新に使う token か GitHub App の鍵を、このリポジトリの secret として持つ必要があります。hosted の App なら、管理者が App をインストールするだけで済みます。
- **手で上げ続ける**: 上げ忘れが残り、Scorecard の指摘に答えられません。

## Consequences

- 設定は `renovate.jsonc` です。App は default branch の設定を読むので、main に merge するまで動きません。インストールは管理者の操作です ([Renovate](../tooling/renovate))。
- betterleaks のメジャー更新は出しません ([ADR 0003](0003-pin-betterleaks-v1))。v2 が安定版になったら、ADR を見直したうえで人が上げます。
- `.betterleaks.toml` の `betterleaksMinVersion` は、`mise.toml` の betterleaks と同じ版でなければなりません (`scripts/check-repo-policy.sh` が検査します)。Renovate の regex manager で `betterleaksMinVersion` も検出し、`groupName` を betterleaks にそろえて、`mise.toml`、`mise.lock`、`.betterleaks.toml` を1つの PR で更新します。この PR が CI で落ちたら、人が直します。
- Node.js と `@types/node` のメジャー更新は出しません。メジャー版は `.node-version`、`engines.node`、catalog の `@types/node`、build target、Lambda の runtime がそろって決まるので ([ADR 0013](0013-api-on-ecs-and-lambda-web-functions))、人が `.node-version` から変えます。
- `runs-on` の image (`ubuntu-24.04`) は更新しません。runner の OS を変えるのは、固定した道具の版を上げることと別の判断です。これは判断です。
- PR のタイトルは `chore(deps): ...` にそろえます ([ADR 0004](0004-squash-merge-and-pr-title-lint))。Renovate は main の履歴から Conventional Commits を検出しますが、検出に頼らず `semanticCommits` を `enabled` にします。
- `mise.lock` の更新は、Renovate が `mise lock` を実行して行います。`--platform` を付けない `mise lock` は、lock に既にある platform だけを更新するので ([mise lock](https://mise.jdx.dev/dev-tools/mise-lock.html))、`linux-x64` だけの記録は保たれます。
- zizmor や actionlint の版が上がって指摘が増えたら、その PR で直します ([ADR 0012](0012-lint-workflows))。
- 設定の検査は CI にありません。`renovate.jsonc` を変えたら、手で `renovate-config-validator` を実行します。
