---
type: Convention
title: 工場の成果の指標
description: ソフトウェアファクトリーの成果を、手直し (first-pass acceptance)、手戻り、CI の feedback loop の時間の 3 つで測る規則。指標の定義、測らないものとその理由、rework のラベルの付け方、手戻りの判定、集計のスクリプトの使い方、モデルと Kiro の版を変えた日の記録を定める。PR に人の指摘を受けて push するとき、修正や revert の PR を書くとき、指標を集計して読むとき、モデルや Kiro の版を変えたときに読む。
tags: [agents, metrics, convention, github, ci]
---

# 工場の成果の指標

工場の成果を、手直し、手戻り、CI の feedback loop の時間の 3 つで測ります。
何をどう測るかを決めた経緯は、[Issue #39](https://github.com/yokozi-jp/agent-software-factory/issues/39) の解決のコメントにあります。

## 目的

ここで言う生産性は、人の手直しと手戻りが少なく、センサーが速く結果を返すほど高いものです。
値は、ハーネスの変更の前後と、月ごとの傾向として人が読みます。

- **目標値を置きません。** DORA は、指標を目標にするとチームが指標を操作しやすくなる (Goodhart の法則) ことを、よくある落とし穴に挙げています ([DORA の software delivery performance metrics](https://dora.dev/guides/dora-metrics/) の "Common pitfalls")。
- **「AI がないときの何倍」とは言いません。** AI を使わない場合という、比べる相手がないためです。
- **3 つを一緒に読みます。** 手直しを減らそうと検査を緩めれば手戻りが増え、検査を足せば feedback loop が延びます。DORA も、1 つの指標だけで測らず、互いに張り合う指標を並べるよう勧めています (同じ節)。
- **因果関係は言いません。** ハーネスの変更は間隔が短く (2026-10-24 だけで約 30 件の merge。Issue #39)、モデルの版でも値が動くためです。

## 指標

| 指標                       | 定義                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| first-pass acceptance      | エージェントが作って merge された PR のうち、`rework` のラベルがない割合                                                     |
| 手戻りの割合               | エージェントが作って merge された PR のうち、後で `revert:` の PR に戻されたか、修正の PR に名指しされた割合。日数の窓はない |
| CI の feedback loop の時間 | PR に push してから、必須チェックがすべて終わるまでの時間。週ごとの中央値と p90                                              |

手直しと手戻りの意味は [GLOSSARY.md](../../GLOSSARY.md) にあります。
first-pass acceptance の手直しは、PR ができてから merge までに、人の指摘を受けて加えた変更だけです。
PR の前の会話での訂正と、CI の失敗をエージェントが自分で直した変更は数えません。

### 数える PR

- **エージェントが作った PR**: merge された PR のうち、作った人が bot (GitHub の user の type が `Bot`) でないものです。Renovate の PR (`renovate[bot]`) は数えません。このリポジトリでは、bot でない PR はすべてエージェントが作ります。どの PR も同じ `yokozi-jp` から出るので、GitHub のデータではエージェントと人の PR を分けられません (Issue #39)。
- **サンプル機能の PR とハーネスの PR**: 変えたファイルの場所で分け、指標を別々に出します。`apps/` か `packages/` の project の中のファイルを 1 つでも変えた PR は、サンプル機能の PR です。ほかのファイルも変えていても、サンプル機能の PR に入れます。ただし、project の中の `lint/` (自作の lint の規則) と、project の直下の `package.json`、`tsconfig.json`、`vite.config.ts` はハーネスに入れます (判断。lint の規則はセンサーで、設定ファイルはテストや build の設定を持つため)。名前を変えたファイルは、前の場所でも判定します。主に読むのはサンプル機能の PR の値で、サンプル機能の実装が始まるまでは値が出ません。
- **月と週**: merge した日と push した日を、日本時間 (JST) で数えます。週は月曜から始めます。

### 手戻りの判定

次のどちらかの PR に名指しされ、その PR より前に merge されていた PR が、手戻りです。名指しした PR が merge されていることも条件です。

- PR テンプレートの「直す PR: #」の欄に番号を書いた PR。複数あるときは `直す PR: #12, #34` と書きます。
- タイトルが `revert:` で始まり、本文に GitHub の Revert のボタンが書く `Reverts <owner>/<repo>#12` の行がある PR。

日数の窓がないので、最近の月の手戻りの割合は、時間が経って修正の PR が merge されると上がります。

### CI の feedback loop の時間

- **push**: PR の head の commit が、PR が開いている間に `pull_request` の workflow run を起動したときが、1 回の push です。push した時刻は、その commit の最初の workflow run が作られた時刻です。まとめて push した commit のうち、head でないものは run を起動しないので数えません。force push で消えた commit も、run があれば数えます。
- **必須チェック**: `.github/rulesets/protect-main.json` の `required_status_checks` の名前と app の check run です ([GitHub リポジトリの設定](../repository/github-settings.md))。それぞれ、cancelled でなく最初に終わったものの時刻を取ります。失敗も結果を返したので数えます。後の push で cancelled になったなどで、必須チェックが 1 つでも終わらなかった push は数えません。
- **中央値と p90**: 隣の順位の値の間を線形に補います ([numpy の `quantile`](https://numpy.org/doc/stable/reference/generated/numpy.quantile.html) の既定の `linear` と同じ)。pre-push の時間は測りません。手元にしか残らず、中で動く検査は CI とほぼ同じだからです ([Git hook](../tooling/git-hooks.md)、Issue #39)。

## 測らないもの

次のものは指標にせず、集計のスクリプトも出力しません。どの値にも目標値を置きません。

| 測らないもの         | 理由                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 行数                 | エージェントは行を安く増やせるので、多いことは成果を示しません。指標にすると、行を増やす方へ向かいます (判断)                                                                                                                                                                                                                                |
| PR の数              | PR の分け方で増減し、手直しも手戻りも映しません。deploy の回数を数える DORA の deployment frequency ([DORA](https://dora.dev/guides/dora-metrics/)) と、1 人の 1 週間あたりの merge された PR の数である DX Core 4 の PR throughput ([Guide to the DX Core 4](https://docs.getdx.com/dx-core-4/)) も、ここでは PR の数と同じなので採りません |
| commit の数          | PR の数と同じく、分け方で増減します。squash merge なので main の commit は PR の数と同じです ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))                                                                                                                                                                                     |
| エージェントごとの数 | 比べるのはハーネスの変更の前と後で、エージェントどうしではありません。どの PR も同じ `yokozi-jp` から出るので、エージェントを見分けられません                                                                                                                                                                                                |

スクリプトが出す件数は、割合の分母と分子、中央値と p90 の元になった push の数だけです。

## rework のラベル

GitHub のデータからは手直しを読み取れないので、ラベルで記録します。PR も commit も同じ `yokozi-jp` から出てレビューの記録が残らず、自分の PR には Request changes を付けられないためです (Issue #39)。

- PR ができてから merge までに、人の指摘を受けて変更を push したら、エージェントはその PR に `rework` のラベルを付けます。1 つの PR に 1 回付ければ足ります。
- PR の前の会話での訂正と、CI やセンサーの結果を見て自分で直した変更では付けません。
- 付け忘れは、merge のときに人が付けます。

ラベルは 2026-10-26 に作りました。テンプレートから作ったリポジトリなど、ラベルがないリポジトリでは、管理者が作ります。

```sh
gh label create rework --color d93f0b --description "PR ができてから人の指摘で変更を push した (手直し)。docs/agents/factory-metrics.md"
```

```sh
gh pr edit <PR の番号> --add-label rework
```

`gh pr edit` が使えない環境では、REST API で付けます。

```sh
gh api --method POST "repos/{owner}/{repo}/issues/<PR の番号>/labels" -f "labels[]=rework"
```

## 集計のスクリプト

期間を指定して、手元で集計します。
GitHub から何度でも計算し直せるので、結果を保存する仕組みと、定期の workflow は作りません。

```sh
# 期間 (JST の日、--until の日を含む。--until を省くと今まで)
node tools/scripts/src/metrics/cli.ts --since 2026-10-01 --until 2026-10-31
# 境目の PR の前と後の N 件 (境目の PR は含めない)
node tools/scripts/src/metrics/cli.ts --pr 180 --count 10
```

- リポジトリの中で実行します。`gh` が認証済みである必要があります。API のパスの `{owner}/{repo}` は、`gh` が今のディレクトリのリポジトリか、環境変数 `GH_REPO` で指定したリポジトリから埋めます ([gh api の manual](https://cli.github.com/manual/gh_api))。
- 期間の形は、月ごとに first-pass acceptance と手戻りの割合を出し、その横にその月に merge されたハーネスの PR を並べます。続けて、CI の feedback loop の時間を週ごとに出します。
- 境目の形は、1 つの変更を確かめたいときだけ使います。前と後のそれぞれで、3 つの指標を出します。
- 閉じた PR をすべて読み、数える PR ごとに、ファイル、workflow run、push ごとの check run を読みます。2026-10-25 と 10-26 の 2 日 (28 件の PR) を集計したときは、約 2 分 20 秒かかりました。進み具合は標準エラーに出します。
- 実装は `tools/scripts/src/metrics/` にあります。数え方は `metrics.ts`、出力は `report.ts` です。

## モデルと Kiro の版を変えた日

モデルの版は GitHub に残らないので、変えた日にここへ 1 行足します。
月ごとの値を読むときに、ハーネスの PR と一緒に、この表の変更を並べて読みます。

| 日付 (JST) | 変えたもの | 変更前 | 変更後 |
| ---------- | ---------- | ------ | ------ |
