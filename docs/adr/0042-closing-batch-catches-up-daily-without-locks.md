---
type: ADR
title: "ADR 0042: 締めのバッチは、締めの表から締める月を決めて毎日追いつき、Step Functions の Map でテナントを回し、ロックを取らない"
description: 締めのバッチ（経費精算の月次の締め）の決定。業務日付マスタを置かず、締めの表の「最後に締めた月」から締める月を決めて毎日 10:00 に追いつく。Scheduler → Step Functions → RunTask の間で、テナントの一覧のタスク（waitForTaskToken）と Map と RunTask.sync でテナントを回す。オンラインとはロックも REPEATABLE READ も使わない。照合は結合落ちの検知だけ、再開の単位はテナントと月、バッチは Hono にせず環境変数を zod で検査する CLI、テナントの一覧のため closing_module に auth の organization の id の列だけを読ませる。比べた案は、業務日付マスタ、前の月が未締めなら失敗、Scheduler から ECS を直接起動、アプリがテナントを回す、FOR UPDATE、REPEATABLE READ、自分の出力の照合、CLI の引数。締めのジョブを実装するとき、業務日付のマスタを置きたくなったとき、締めにロックを足したくなったとき、バッチの入口を Hono にしたくなったとき、Step Functions の Retry や redrive を変えるときに読む。
tags: [adr, batch, closing, step-functions, ecs, idempotency, outbox]
---

# ADR 0042: 締めのバッチは、締めの表から締める月を決めて毎日追いつき、Step Functions の Map でテナントを回し、ロックを取らない

サンプル機能（経費精算）は、経理が確認した申請を月ごとに締め、会計システムへ CSV とマニフェストを置きます ([ADR 0023](0023-ky-for-external-http-and-sdk-retries-for-aws.md)、[ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md))。この締めのバッチの業務日付、照合、再実行、途中からの再開、オンラインとの排他を決めました。決定のいくつかは、取り込んだ [バッチ設計ガイドライン](../batch/about.md) の規約や、ADR 0013、[ADR 0022](0022-better-auth-cookie-bff.md) と違います。違いを理由と一緒に残します。経緯は [締めのバッチの業務日付、照合、再実行、途中からの再開、オンラインとの排他を決める](https://github.com/yokozi-jp/agent-software-factory/issues/354) の解決コメントにあります。

## ルール

- **締める月の決め方**: EventBridge Scheduler が、業務のタイムゾーンの毎日 10:00 に起動します（業務時間に起動する [スケジュールジョブ](../batch/scheduled-jobs.md) の規約に合わせた時刻で、10:00 は判断）。ジョブは「最後に締めた月の次の月」から「起動した時刻の前の月」までを、古い順に締めます。締める月がなければ INFO のログを出して何もせずに終わります。テナントの最初の月は、締めていない承認済みの申請のうち、いちばん古いものの月です。手動のときは、環境変数 `CLOSING_MONTH` で「どの月まで締めるか」を渡します。業務日付マスタと日付を切り替えるジョブは置きません。締めの表が「最後に締めた月」を持ち、その役をします。
- **対象と境界**: 月 M の対象は、経理の確認が境界より前で、まだどの締めにも入っていない申請です。境界は「業務のタイムゾーンの翌月 1 日 00:00」で、範囲は「以上、未満」で書きます（`BETWEEN` は使いません）。境界は、IANA のタイムゾーン名から計算する純粋な関数が求め、プロセスと DB のセッションのタイムゾーンに頼りません。業務のタイムゾーンは、システムで 1 つの `Asia/Tokyo` です ([ADR 0043](0043-instants-in-utc-business-calendar-in-tokyo-with-temporal.md))。
- **ワークフロー**: ADR 0013 のとおり、Scheduler → Step Functions → RunTask と挟みます。Step Functions の実行名を環境変数でタスクに渡し、共通カラムの `tx_id` に入れます。
- **テナントの回し方**: 最初に、テナントの一覧を返すタスクを `RunTask.waitForTaskToken` で起動します（タスクは `SendTaskSuccess` で一覧を返す）。その一覧を Map で回し、テナントごとに締めのタスクを `RunTask.sync` で起動します。1 つのテナントが失敗しても、ほかのテナントは止まりません。失敗したテナントは redrive できます。ジョブの中身（`application` と `infrastructure`）は Effect で書きます ([ADR 0028](0028-effect-in-application-and-infrastructure.md))。
- **テナントの一覧の権限**: `closing_module` に、`auth."organization"` の `id` の列だけの `SELECT` を与えます。ADR 0022 の「アプリ用のロールは `auth` を読めない」の例外です。ほかの列とほかの `auth` の表は読めません。`auth` の表は `auth_service` しか読めず（`packages/db/migrations/20261027000000_create_auth_schema.sql`）、列を限った `SELECT` なら、テナントの id は秘密ではないので足りるためです。
- **オンラインとの排他**: ロックを取らず、分離レベルは PostgreSQL の既定の `READ COMMITTED` のままにします（[Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)）。経理が確認した申請は締め以外の状態に移らず、締めが書くのは自分の表と Outbox だけだからです。[ほかのモジュールの公開関数が読むときのトランザクションとロールの扱いを決める](https://github.com/yokozi-jp/agent-software-factory/issues/273) の決定 5 の問題は起きません。確認を取り消す操作を足すときに見直します。
- **締め済みを申請に伝える**: 締めのトランザクションで、締めの行（テナント、月、状態、`tx_id`）、締めた申請の行、申請 1 件ごとに 1 つの Outbox のイベントを書きます。申請のモジュールがイベントを受け取り、申請を締め済みにします ([ADR 0029](0029-module-data-ownership-and-shared-outbox.md))。
- **照合**: 承認のモジュールから読んだ申請の id が、申請のモジュールに 1 件でも見つからなければ、rollback して失敗させます（結合落ちの検知）。読んだ件数、書いた件数、合計を、終了のログの `batch.stats` に出し、マニフェストには件数と合計を書きます。自分が書いた行とマニフェストを、アプリの中では比べません。CSV とマニフェストの照合は会計システムが行います。[サンプル機能の題材と範囲を決める](https://github.com/yokozi-jp/agent-software-factory/issues/26) の「件数と合計の照合」は、この意味に読み替えます。
- **再実行と途中からの再開**: 再開の単位は、テナントと月の組です。締めの行に状態（確定済み、配信済み）を持ち、済んだ手順を飛ばします。ジョブは毎回先頭から流れ、確定済みなら保存した行から同じバイト列の CSV を作り直します。同じ締めが 2 本同時に走ったときは、`(tenant_id, closing_month)` の一意制約で負けた側が、確定済みとして続きを流します。Step Functions の `Retry` は 2 回（指数のバックオフ。回数は判断）で、それでも失敗した分は翌日の起動が続きを流します。実行の記録の表は別に置きません。
- **0 件の月**: ヘッダ行だけの CSV と、件数 0 のマニフェストを置き、INFO のログを出します。
- **入口とパラメータ**: バッチは Hono のアプリにしません。入口は ECS のタスクのコマンドとして動く CLI で、次の順に動きます。
  1. 環境変数（締める月、テナント、`tx_id`、タスクのトークン）を zod で検査する。
  2. `ManagedRuntime` を作って実行する。
  3. 開始と終了のログを出す。
  4. `dispose` してから終了コードで終わる。

  値は、タスク定義の環境変数の上書きで渡します。CLI の引数では渡しません。

## 試験

- 純粋な関数の unit test: 締める月の範囲、境界の時刻、CSV。
- 結合テスト: ジョブの `application` の関数を、testcontainers の PostgreSQL と S3Mock に向けて呼びます。2 回流しても結果が同じこと、0 件、日回し（毎日起動して 3 か月続け、境界の前後 1 ms の確認を置く）、月を飛ばした後の追いつき、途中で落とした後の再開、2 つのテナントの分離、同時に 2 本、結合落ちを確かめます。
- Step Functions はテストで通しません。定義はインフラの spec の CDK assertions で確かめ、TestState API は検証環境で使います。

## 標準との違い

- **業務日付マスタを置かない**: [業務日付](../batch/business-date.md) は、業務日付を RDB の表で持ち、切り替えのジョブで進める形を勧めています。締めは月に 1 本で、オンラインは業務日付を使いません。締めの表が「最後に締めた月」を持つので、マスタの役を兼ねます（判断）。
- **Scheduler から ECS を直接起動しない**: [ワークフローエンジン](../batch/workflow-engine.md) は、依存のない 1 本のジョブなら Scheduler から ECS を直接起動するよう勧めています。それでも ADR 0013 のとおり Step Functions を挟む理由は 3 つです（判断）。
  - タスクの失敗の再試行は Step Functions の `Retry` が行う。Scheduler の `RetryPolicy` が再試行するのは、ターゲットへのイベントの配信（API の呼び出し）の失敗だけである（[RetryPolicy](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_RetryPolicy.html)）。
  - 失敗した実行の数を `ExecutionsFailed` の 1 つのメトリクスで検知できる（[Viewing metrics](https://docs.aws.amazon.com/step-functions/latest/dg/procedure-cw-metrics.html)）。
  - このテンプレートが対象にする SI のバッチでは、ジョブ同士の依存が普通にある。
- **毎日起動して空振りさせる**: 月次のジョブも毎日起動し、アプリの側で何もしないで終わらせる形は、[スケジュールジョブ](../batch/scheduled-jobs.md) に沿います。前回が失敗しても次回がそのまま続きを流す形も、規約が勧めるものです。
- **自分の出力の照合をしない**: [ジョブ設計](../batch/job-design.md) は、結合落ちを検知し、自分の出力の正しさはテストで担保するとしています。それに沿います。
- **Effect をワークフローに使わない**: Effect 4 の `Workflow` は unstable の module で、定義に `Schema` が要ります（[Workflow の API](https://effect.website/docs/v4/api/effect/workflow/Workflow)）。ADR 0028 は、unstable の module、`Schema`、`Schedule` の再試行を使わないと決めています。ADR 0023 も、AWS の呼び出しを Effect の再試行で重ねないと決めています。
- **バッチを Hono のアプリにしない**: 非 HTTP のイベントを `app.request()` で route に流す形は、Hono の標準ではありません（[ワーカーとバッチを Hono のアプリとして書く案の標準とアンチパターンを調べる（ECS の常駐、Lambda Event Functions と Web Functions、Step Functions の RunTask）](https://github.com/yokozi-jp/agent-software-factory/issues/348)）。
- **避けるアンチパターン**: 前の月が未締めなら失敗させて毎回手で再実行する運用（[追い越し制御](../interface/overtaking-control.md) が避けるよう勧める）。時刻の範囲に `BETWEEN` を使うこと（PostgreSQL の wiki の [Don't Do This](https://wiki.postgresql.org/wiki/Don't_Do_This)）。

## Considered Options

- **業務日付マスタと切り替えのジョブ**: 締めが 1 本だけの今は、作るものが増えるだけです。
- **前の月が未締めなら失敗させる**: 毎回、手で再実行する運用になります。
- **Scheduler から ECS を直接起動する**: 上の「標準との違い」の 3 つの理由で採りません。
- **アプリがテナントを回す**: 回し方をアプリとワークフローエンジンの 2 か所で制御することになります。
- **`FOR UPDATE`、`REPEATABLE READ`、表のロック**: `FOR UPDATE` には `UPDATE` 権限も要り、`SELECT` だけのロールでは取れません（[SELECT](https://www.postgresql.org/docs/current/sql-select.html)）。ほかの 2 つは、読む行が確認の後に変わらないので要りません。
- **書いた行とマニフェストをアプリの中で比べる**: 自分の出力の検証はテストで担保します。
- **一覧のタスクが `auth_service` でつなぐ**: バッチが `auth` の全表を読み書きできてしまいます。
- **テナントの一覧を Parameter Store に置く**: テナントを足すたびに設定を直す運用が要り、DB とずれます。
- **テナントの作成をイベントで受けて写す**: 今は Better Auth にイベントを出す仕組みがありません。
- **CLI の引数で値を渡す**: [パラメータ](../batch/parameters.md) は、タスク定義の上書きを環境変数だけにするとしています。

## Consequences

- 締めのジョブを実装するエージェントは、業務日付マスタを作らず、締めの表の「最後に締めた月」から締める月を求めます。
- 確認を取り消す操作を足すときは、ロックを取らない前提（オンラインの更新と競合しない）が崩れるので、排他を決め直します。
- 締めの境界のタイムゾーンは、日時とタイムゾーンの決定（Issue 365）が出るまで、「業務のタイムゾーン」という名前のままです。
- `closing_module` の権限の付与と、そのカタログのテストは [モジュールのロールを分け、DB のカタログで表の所有を検査する](https://github.com/yokozi-jp/agent-software-factory/issues/268) で行います。

## 確かめられなかったこと

- ジョブの本体と Scheduler、Step Functions の CDK は書いていません。
- Step Functions の `RunTask.sync` が、コンテナが 0 以外の終了コードで終わったときに返す `Error` と `Cause` の形は、AWS 上で確かめていません（[調査](https://github.com/yokozi-jp/agent-software-factory/blob/19052bbb6c8724e54f3d2859db69aba521847039/research/step-functions-testing.md)）。
- Scheduler が起動した実行を redrive できることは、文書から判断しただけで、AWS 上では試していません。

## 出典

- 業務日付と切り替えの規約: [業務日付](../batch/business-date.md)、[スケジュールジョブ](../batch/scheduled-jobs.md)、[追い越し制御](../interface/overtaking-control.md)、[ジョブ設計](../batch/job-design.md)、[ワークフローエンジン](../batch/workflow-engine.md)
- redrive が失敗した状態から同じ入力で続け、成功した状態をやり直さないこと: [Redriving state machine executions](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html) (2026-10-29 に確かめた)
- TestState API が、モック付きの `.sync`、Map、`Retry` を試せること: [Using TestState API to test a state](https://docs.aws.amazon.com/step-functions/latest/dg/test-state-isolation.html) (2026-10-29 に確かめた)
- Scheduler の `RetryPolicy`、Step Functions の `ExecutionsFailed`、Effect の `Workflow`、PostgreSQL の `READ COMMITTED` と `FOR UPDATE` の権限: 本文のリンク先 (2026-10-29 に確かめた)
- 時刻の範囲に `BETWEEN` を使わない: [Don't Do This - PostgreSQL wiki](https://wiki.postgresql.org/wiki/Don't_Do_This)
