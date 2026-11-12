---
type: ADR
title: "ADR 0055: Renovate の PR は、CI が通れば Renovate が merge する範囲を決めて自動にする"
description: 人が毎回 merge していた Renovate の PR のうち、npm の minor と patch (1.0 以上) と lock file の更新を、必須チェックが通れば GitHub の auto-merge で Renovate が merge する決定。メジャー版、0.x、GitHub Action と mise の道具、認証のライブラリ、Node.js と pnpm、effect-tsgo と Vite+ は人が merge する。自動にした PR には automerge のラベルを付け、手戻りが出たら止める。自動にする範囲を広げる、狭める、止めるとき、Renovate の PR が人の確認なしに merge されて困ったときに読む。
tags: [adr, tooling, renovate, github, supply-chain]
---

# ADR 0055: Renovate の PR は、CI が通れば Renovate が merge する範囲を決めて自動にする

[ADR 0018](0018-renovate-for-pinned-versions.md) で Renovate が PR を出すようにした後、PR を merge する作業が人に残りました。2026-11-08 から 11-12 の 5 日間に、Renovate は 40 本の PR を出し (#640 から #688)、38 本が merge されました。2 本は意図して閉じた minimatch の PR です。merge までの時間は数分から数時間のものが多く、人がしていたのは CI の結果を見てボタンを押すことでした。

`renovate.md` の「PR を merge する前に」には、人が見る項目がありました。`mise.lock` が変わっていること、betterleaks の 3 ファイルが同じ版であること、Action の SHA とコメントの版が変わっていること、catalog の更新で `pnpm-lock.yaml` が変わっていることです。このうち `mise.lock` の更新漏れ (`MISE_LOCKED=1`) と betterleaks の 3 ファイルの版 (repo-policy) は、すでに CI が止めます。`mise.lock` に `linux-x64` 以外の platform が増えていないことだけが、人の目に頼っていました。

ruleset は必須チェック (`main`、`commitlint`、`betterleaks`、`dependency-review`) と CodeQL (`code_scanning`) を強制し、承認の数は 0 です ([GitHub リポジトリの設定](../repository/github-settings.md))。承認が要らないので、Renovate が PR を merge するのに ruleset の変更は要りません。

## 決定

必須チェックが通った PR を、Renovate が GitHub の auto-merge で merge します (`platformAutomerge` の既定)。自動にする範囲は次のとおりです。

| 自動にする                                                           | 理由                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lock file の更新 (`pnpm-lock.yaml`、`mise.lock`、semgrep の sidecar) | 依存の定義を変えず lock を作り直すだけの更新。Renovate の文書は、自動にする更新の中で最も危険が小さいだろうと書く ([Renovate の automerge](https://docs.renovatebot.com/key-concepts/automerge/))       |
| npm の minor と patch。現在の版が 1.0 以上のもの                     | [Renovate が勧める範囲](https://docs.renovatebot.com/key-concepts/automerge/)。0.x は semver 上いつ壊れてもよいので除く。公開から 3 日待つ (`config:best-practices` の `security:minimumReleaseAgeNpm`) |

自動にした PR には `automerge` のラベルを付けます。人が merge する PR には付けません。

人が merge するもの: メジャー版、0.x、GitHub Action と mise の道具 (patch も)、`better-auth` と `oidc-provider` (認証)、Node.js ([ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md))、pnpm (全ての検査の土台なので、人が見る。判断です)、`renovate.sh` が使う Renovate 自身、`@effect/tsgo` と Vite+ の PR ([ADR 0028](0028-effect-in-application-and-infrastructure.md))、docker のタグ (ローカルの開発用で、CI が動かさない)。

Action と mise の道具は、最初の版 (PR #692) では patch を自動にしていましたが、同じ日 (2026-11-12) に外しました ([Issue #201](https://github.com/yokozi-jp/agent-software-factory/issues/201))。Action は CI の中で実行され、更新は `.github/workflows` を変えます。mise の道具には検査器 (betterleaks、zizmor、osv-scanner、semgrep) があり、検出の漏れが「指摘なし」の成功と見分けられません (下の Considered Options)。判断です。

CI が落ちた PR は、これまでどおり open のまま残り、人が直します。

## Considered Options

- **全て手で merge する (現状)**: 確認の中身が CI の結果だけなので、手間に見合う確認になっていません。
- **Action と mise の道具を自動にする (patch まで、minor まで)**: 検出の漏れが「指摘なし」の成功と見分けられない道具 (betterleaks、zizmor、osv-scanner、semgrep) があり、Action の更新は CI の中で実行される workflow を変えます。patch でも自動にしません。Issue #35 の決定 (対象は lock file の更新と devDependencies の patch と minor に絞り、Action と mise の道具の更新は人が見る) とも合います。
- **devDependencies と `@types/*` だけに絞る (Issue #35)**: pnpm の catalog の依存は、Renovate が depType を `pnpm.catalog.<名前>` にするので、`devDependencies` では絞れません ([Renovate の npm manager](https://docs.renovatebot.com/modules/manager/npm/))。絞るなら `matchPackageNames` の許可リストを手で保守することになり、依存を足すたびに書き足しが要ります。メジャー版と 0.x を除き、人が merge する依存を名指しで外すことで、同じ目的を満たします (判断)。
- **自動にする PR だけ待機期間を 7 日にする (Issue #35)**: npm の 3 日は、公開から 72 時間は package を取り消せることが根拠です ([Renovate の minimumReleaseAge](https://docs.renovatebot.com/configuration-options/#minimumreleaseage))。7 日の根拠になる出典は見つかっていないので、足しません。足りないと分かったら、自動にする規則の `minimumReleaseAge` で延ばせます。
- **着手の条件 (集計できてから、4 週間連続で人の手入れなしに merge できてから) を置く (Issue #201)**: PR #692 が先に自動にしたので、置けません。止める手順を整え、手戻りが出たら止める (下の「影響」) ことで代えます。
- **GitHub の merge queue を使う**: Renovate の文書が [GitHub の merge queue](https://docs.renovatebot.com/key-concepts/automerge/#github-merge-queue) として挙げる方式で、変更を base と合わせて検査してから merge します。全ての必須 workflow に `merge_group` を足し、人の merge にも効くので、重くなります。今は入れません (下の「影響」)。
- **Renovate を ruleset の bypass に入れる、approve 用の helper app を入れる**: 承認が 0 なので不要で、入れると main に入る経路が増えるだけです。

## 影響

- リポジトリの設定「Allow auto-merge」を有効にします (`gh repo edit --enable-auto-merge`、管理者)。
- 自動にする範囲は、CI が行使するものに限りました。更新が正しいかは CI の結果で決まり、人は見ません。この前提が崩れる更新 (CI が動かさない道具) は、自動にしません。
- 待機期間 (`minimumReleaseAge` の 3 日) は、公開された版がすぐ main に入る供給網の攻撃への防御です。npm は `config:best-practices` の `security:minimumReleaseAgeNpm` で効きます ([Renovate の presets](https://docs.renovatebot.com/presets-config/))。Action と mise の道具は人が merge するので、この規則は置いていません。
- 自動にした PR が手戻りになったら (`revert:` の PR に戻された、「直す PR: #」で名指しされた、merge の直後に main の CI が落ちた)、その種類の自動 merge を止めます。`rework` のラベルは信号にしません。人が見ないまま merge した PR には付かないためです。手順は [Renovate](../tooling/renovate.md) にあります (判断)。
- repo-policy が `renovate.jsonc` を読み、`automerge: true` の規則が npm の minor と patch だけを対象にしていること、`automerge` のラベルが付くこと、人が merge する依存の規則がその後ろにあることを確かめます。Renovate の規則の重なりを再現しない簡単な検査で、実際の結果は `renovate.sh preview` で見ます。
- `mise.lock` に `linux-x64` だけを記録することを、repo-policy が検査します ([ADR 0009](0009-mise-for-pinned-cli-tools.md))。人が見ていた項目を CI に移したものです。
- `strict_required_status_checks_policy` は `false` のままです。GitHub の auto-merge は base に遅れた PR も merge するので ([Renovate の platformAutomerge](https://docs.renovatebot.com/configuration-options/#platformautomerge))、同じ `pnpm-lock.yaml` を触る 2 本が、互いの変更を知らずに通る可能性があります。main への push でも CI が動くので気づけます。事故が出たら merge queue を入れます (判断)。
- 止めるには、`renovate.jsonc` の自動にする規則を直します。「Allow auto-merge」を無効にする方法は、止まる保証がないので手順にしません。Renovate の文書は、プラットフォームの auto-merge が使えないと Renovate の automerge に戻ると書きます ([platformAutomerge](https://docs.renovatebot.com/configuration-options/#platformautomerge))。この設定の無効化が「使えない」に当たるかは確かめていません (推論)。PR #692 の初版は、この設定の無効化を止める手順として書いていました。
