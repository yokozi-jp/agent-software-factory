---
type: ADR
title: "ADR 0023: 外部システムへの HTTP の呼び出しは ky でタイムアウトと再試行を持ち、AWS のサービスは SDK の再試行に任せて重ねない"
description: 人事システムのような外部システムへの HTTP の呼び出しを ky で書き、試行ごとと全体のタイムアウト、GET だけの再試行、ジッターを ky の設定に置き、AWS のサービス（S3、SQS、SES）の呼び出しは AWS SDK の standard mode の再試行に任せて、その外側に再試行を重ねないとした決定。外部システムを呼ぶクライアントを足すとき、タイムアウトや再試行の値を変えるとき、再試行やサーキットブレーカーの library を足したくなったとき、AWS SDK の呼び出しを再試行で包みたくなったとき、AWS SDK の retry mode や max attempts を変えるときに読む。
tags: [adr, http, retry, timeout, aws-sdk, resilience]
---

# ADR 0023: 外部システムへの HTTP の呼び出しは ky でタイムアウトと再試行を持ち、AWS のサービスは SDK の再試行に任せて重ねない

サンプル機能（経費精算）は、ログインと申請のたびに人事システムを HTTP で呼び、締めでは S3 に CSV を置きます。どちらも一時的な失敗が起きるので、タイムアウトと再試行が要ります。Node.js には標準の再試行の library がなく、AWS SDK は自分で再試行します。そこで、外部システムへの HTTP の呼び出しは ky で書いてタイムアウトと再試行を ky の設定に置き、AWS のサービスは SDK の再試行に任せて、その外側に再試行を重ねないことにします。経緯は [外部システムのフェイクと CSV を置く先を決める](https://github.com/yokozi-jp/agent-software-factory/issues/75) にあります。

## ルール

- 外部システム（AWS 以外）への HTTP の呼び出しは [ky](https://github.com/sindresorhus/ky) で書きます。版は pnpm の catalog で固定し、Renovate で上げます（ADR 0018）。ky は `fetch` の上の薄い wrapper で依存がないので、アプリのコードを Web 標準の API で書く ADR 0007 に合います。
- タイムアウトと再試行は、クライアントごとに ky の設定に置き、業務のコードでループを書きません。人事システムは次の値にします（数値は判断）。
  - `timeout: 2000`（試行ごと）、`totalTimeout: 5000`（再試行と待ち時間を含む全体）
  - `retry: { limit: 2, methods: ['get'], retryOnTimeout: true, jitter: true }`。再試行する状態コードは ky の既定（408、413、429、500、502、503、504）のままにし、429 と 503 では `Retry-After` に従います。4xx（408、413、429 を除く）は再試行しません。
  - ky の既定は、タイムアウトで再試行せず（`retryOnTimeout: false`）、ジッターもない（`jitter: undefined`）ので、この2つは必ず明示します。
- 再試行するのは、冪等な GET だけです。POST などを再試行したくなったら、相手が冪等キーを受けるかを先に確かめます（`docs/web-api/idempotency-and-patch.md`）。
- サーキットブレーカーは入れません。AWS の Builders' Library は、サーキットブレーカーが試験しにくい状態の切り替えを持ち込み、回復を遅らせることがあるとし、代わりに手元で再試行を絞ることを勧めています（[Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)）。人事システムが止まったときは、ログインも申請も失敗として返します（ADR 0022 の fail closed）。
- AWS のサービス（S3、SQS、SES など）は AWS SDK の再試行に任せます。SDK の既定は standard mode で、最大 3 回の試行（最初の要求と2回の再試行）、ジッター付きの指数バックオフ、再試行を絞る token bucket（retry quota）を持ちます（[AWS SDKs and Tools: Retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)）。SDK の呼び出しを ky、p-retry、自前のループで包みません。
- 1つの呼び出しで再試行する層は1つにします。層を重ねると試行の回数が掛け算で増え、止まりかけた相手への負荷を増やします。AWS は、安い操作は stack の1か所でだけ再試行するのを best practice とします（同じ Builders' Library）。

## Considered Options

- **自前で `fetch` と `AbortSignal.timeout` のループを書く**: 依存は増えませんが、上限、ジッター、全体のタイムアウト、`Retry-After`、再試行してよいメソッドの判定を毎回書くことになり、付け忘れが起きやすくなります。
- **p-retry**: 汎用の再試行だけを持つので、タイムアウトと HTTP の状態コードの判定は自分で書きます。
- **cockatiel**: 再試行、サーキットブレーカー、bulkhead をまとめて持ちますが、サーキットブレーカーを入れないので要りません。
- **AWS SDK も ky と同じ方針で包み、再試行の設定を1か所にまとめる**: 見た目はそろいますが、SDK の再試行と重なり、SDK が持つ throttling ごとのバックオフと retry quota の外で試行が増えます。

## Consequences

- 外部システムのクライアントを足すたびに、タイムアウトと再試行の値を決めます。値は人事システムの値をそのまま写さず、相手の性質（応答の速さ、冪等か、`Retry-After` を返すか）で決めます。
- ワーカー（SQS のメッセージの処理）では、メッセージの再配送が外側の再試行になります。その中の AWS SDK と ky の再試行は既定のまま残し、3つ目の層を足しません（判断）。
- AWS SDK は、新しい再試行の振る舞い（バックオフの時間、retry quota の費用、サービスごとの既定が変わる）を `AWS_NEW_RETRIES_2026=true` の opt-in で提供しています。既定になるまでは opt-in しません。既定が変わったら、テストと CloudWatch のエラー率を見て、この ADR を見直します。
- タイムアウト、接続断、503 の後の 200、毎回の 503、404 の振る舞いは、WireMock の人事システムのフェイクで、受けた要求の回数まで確かめます。
