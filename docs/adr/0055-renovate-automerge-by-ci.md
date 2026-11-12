---
type: ADR
title: "ADR 0055: Renovate の PR は、CI が通れば Renovate が merge する範囲を決めて自動にする"
description: 人が毎回 merge していた Renovate の PR のうち、npm の minor と patch (1.0 以上)、Action と mise の道具の patch、lock file の更新を、必須チェックが通れば GitHub の auto-merge で Renovate が merge する決定。メジャー版、0.x、認証のライブラリ、Node.js と pnpm、effect-tsgo と Vite+ は人が merge する。自動にする範囲を広げる、狭める、止めるとき、Renovate の PR が人の確認なしに merge されて困ったときに読む。
tags: [adr, tooling, renovate, github, supply-chain]
---

# ADR 0055: Renovate の PR は、CI が通れば Renovate が merge する範囲を決めて自動にする

[ADR 0018](0018-renovate-for-pinned-versions.md) で Renovate が PR を出すようにした後、PR を merge する作業が人に残りました。2026-11-08 から 11-12 の 5 日間に、Renovate は 40 本の PR を出し (#640 から #688)、38 本が merge されました。2 本は意図して閉じた minimatch の PR です。merge までの時間は数分から数時間のものが多く、人がしていたのは CI の結果を見てボタンを押すことでした。

`renovate.md` の「PR を merge する前に」には、人が見る項目がありました。`mise.lock` が変わっていること、betterleaks の 3 ファイルが同じ版であること、Action の SHA とコメントの版が変わっていること、catalog の更新で `pnpm-lock.yaml` が変わっていることです。このうち `mise.lock` の更新漏れ (`MISE_LOCKED=1`) と betterleaks の 3 ファイルの版 (repo-policy) は、すでに CI が止めます。`mise.lock` に `linux-x64` 以外の platform が増えていないことだけが、人の目に頼っていました。

ruleset は必須チェック (`main`、`commitlint`、`betterleaks`、`dependency-review`) を強制し、承認の数は 0 です ([GitHub リポジトリの設定](../repository/github-settings.md))。承認が要らないので、Renovate が PR を merge するのに ruleset の変更は要りません。

## 決定

必須チェックが通った PR を、Renovate が GitHub の auto-merge で merge します (`platformAutomerge` の既定)。自動にする範囲は次のとおりです。

| 自動にする                                                           | 理由                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| lock file の更新 (`pnpm-lock.yaml`、`mise.lock`、semgrep の sidecar) | Renovate の文書が、自動にする更新の中で最も危険が小さいとする更新                                          |
| npm の minor と patch。現在の版が 1.0 以上のもの                     | Renovate が勧める範囲。0.x は semver 上いつ壊れてもよいので除く。公開から 3 日待つ (config:best-practices) |
| GitHub Action と mise の道具の patch。公開から 3 日たったもの        | CI の PR で実際に動く。minor は人が見る                                                                    |

人が merge するもの: メジャー版、0.x、`better-auth` と `oidc-provider` (認証)、Node.js と pnpm ([ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md))、`@effect/tsgo` と Vite+ の PR ([ADR 0028](0028-effect-in-application-and-infrastructure.md))、docker のタグ (ローカルの開発用で、CI が動かさない)。

CI が落ちた PR は、これまでどおり open のまま残り、人が直します。

## Considered Options

- **全て手で merge する (現状)**: 確認の中身が CI の結果だけなので、手間に見合う確認になっていません。
- **Action と mise の minor も自動にする**: minor は挙動や入力の変更を含みやすく、検出の漏れが「指摘なし」の成功と見分けられない道具 (betterleaks、zizmor、osv-scanner、semgrep) もあります。patch に留め、実績を見て広げる。
- **GitHub の merge queue を使う**: Renovate の文書が勧める方式で、変更を base と合わせて検査してから merge します。全ての必須 workflow に `merge_group` を足し、人の merge にも効きます。重く、今は入れません (下の「影響」)。
- **Renovate を ruleset の bypass に入れる、approve 用の helper app を入れる**: 承認が 0 なので不要で、入れると main に入る経路が増えるだけです。

## 影響

- リポジトリの設定「Allow auto-merge」を有効にします (`gh repo edit --enable-auto-merge`、管理者)。
- 自動にする範囲は、CI が行使するものに限りました。更新が正しいかは CI の結果で決まり、人は見ません。この前提が崩れる更新 (CI が動かさない道具) を自動にしない。
- 待機期間 (`minimumReleaseAge` の 3 日) は、公開された版がすぐ main に入る供給網の攻撃への防御です。npm は `config:best-practices` で効き、Action と mise の道具は `renovate.jsonc` で足しました。
- `mise.lock` に `linux-x64` だけを記録することを、repo-policy が検査します ([ADR 0009](0009-mise-for-pinned-cli-tools.md))。人が見ていた項目を CI に移したものです。
- `strict_required_status_checks_policy` は `false` のままです。GitHub の auto-merge は base に遅れた PR も merge するので、同じ `pnpm-lock.yaml` を触る 2 本が、互いの変更を知らずに通る可能性があります。main への push でも CI が動くので気づけます。事故が出たら merge queue を入れます (判断)。
- 止めるには、`renovate.jsonc` の自動にする規則を消すか、`gh repo edit --enable-auto-merge=false` を実行します。
- mise の `minimum_release_age` は固定日時です ([ADR 0021](0021-sast-and-dependency-scan.md))。この日付より新しい版を `mise lock` が解決できない道具があると、その更新の PR は CI で落ち、自動にならず人に残ります。mise の道具の更新に Renovate の待機期間が効くか (datasource が公開日時を返すか) も含め、App を有効にした後の最初の Action と mise の patch の PR で確かめます。確かめるまでは、この 2 つは動かない可能性があります。動かなくても、人が merge する今までの手順に戻るだけです。
