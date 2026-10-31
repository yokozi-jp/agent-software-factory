---
type: Runbook
title: ローカルで通知メールのワーカーを動かす
description: PostgreSQL、ElasticMQ、Mailpit を compose で起動し、通知メールのワーカー (apps/worker) を手で起動して、サンプルのメッセージが Mailpit の画面にメールとして届くのを見る手順。ワーカーを手元で動かしたいとき、メールの文面を目で確かめたいとき、ElasticMQ や Mailpit や PostgreSQL のイメージの版を上げるときに読む。
tags: [tooling, runbook, worker, sqs, mail, docker]
---

# ローカルで通知メールのワーカーを動かす

通知メールのワーカー ([ADR 0013](../adr/0013-api-on-ecs-and-lambda-web-functions.md)、[ADR 0041](../adr/0041-standard-queue-per-task-with-dlq.md)) を手元で動かし、Mailpit の画面でメールを見る手順です。SQS は ElasticMQ、メールは Mailpit に代えます。本番の構成ではありません。
結合テストは testcontainers で同じ道具を起こします。この手順は、手で起動して目で確かめるためのものです。

## 起動する

```sh
docker compose -f compose.local.yaml up -d --wait
```

| ポート | 用途                                     |
| ------ | ---------------------------------------- |
| 5432   | PostgreSQL (database は `app`)           |
| 9324   | ElasticMQ (SQS の API。`SQS_ENDPOINT`)   |
| 1025   | Mailpit の SMTP (`SMTP_PORT`)            |
| 8025   | Mailpit の画面 (<http://127.0.0.1:8025>) |

ポートはすべて `127.0.0.1` にだけ開きます。固定のポートなので、一度に起動できるのは 1 つの worktree です ([並行作業と worktree](worktrees.md)、[Issue #184](https://github.com/yokozi-jp/agent-software-factory/issues/184))。[ローカルでトレースを見る](local-telemetry.md)の `compose.otel-lgtm.yaml` とはポートが重ならないので、同時に起動できます。

止めるのは `docker compose -f compose.local.yaml down` です。データも消して最初からやり直すときは `-v` を付けます。

## データベースを用意する

初回の起動で、PostgreSQL に本番と同じ `packages/db/bootstrap.sql` が流れ、ロールができます。パスワードは `docker/postgres-local-roles.sql` が設定します (すべて `local-password`)。この初期化は、データのディレクトリが空のときだけ流れます ([Docker Official Image の postgres](https://hub.docker.com/_/postgres) の Initialization scripts)。データは名前付きボリューム `postgres-data` にあり、`down` では残ります。ロールの作り方を変えたら `down -v` でやり直します。
migration は `migrator` で流します ([ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md))。

```sh
export DATABASE_URL='postgres://migrator:local-password@127.0.0.1:5432/app?sslmode=disable' # betterleaks:allow
pnpm --filter @agent-software-factory/db db:migrate
pnpm --filter @agent-software-factory/db db:seed   # 任意。ワーカーは seed の行を読まない
```

`db:seed` は一度しか流せません。流し直すときは `down -v` で DB を作り直します。ワーカーは `app_user` で接続するので (RLS を迂回しない、[ADR 0011](../adr/0011-tenant-id-and-rls-from-the-start.md))、`APP_DATABASE_URL` は `app_user` の URL です。

## ワーカーを起動する

`apps/worker/.env.example` を同じディレクトリの `.env` に写します。`.env` は git に入りません。値は compose に合わせてあります。

```sh
pnpm --filter @agent-software-factory/worker setup-queues   # キューと DLQ を作る。何度流してもよい
pnpm --filter @agent-software-factory/worker start          # 止めるのは Ctrl-C (処理中の 1 件を終えてから止まる)
```

`setup-queues` は `createNotificationQueues` ([ADR 0041](../adr/0041-standard-queue-per-task-with-dlq.md) の値) を呼びます。ElasticMQ を作り直したら、もう一度流します。

## メッセージを入れる

別の端末で流します。

```sh
pnpm --filter @agent-software-factory/worker send-sample [宛先のメールアドレス]
```

承認依頼のサンプル (`approval.notification_requested`) を 1 件入れます。数秒後に、Mailpit の画面に「【承認依頼】10月の交通費」が届きます。本来はこのメッセージを Outbox を送る処理が入れます (その処理は未実装)。
`id` は毎回新しくします。同じ `id` は `processed_message` に残り、2 回目は重複として捨てられ、メールが出ません。

## 版を上げるとき

ElasticMQ と Mailpit のイメージは `compose.local.yaml` が持ち、結合テスト (`apps/worker/test/containers.ts`) もそこから読みます。ElasticMQ の設定は `docker/elasticmq.conf` です。`compose.local.yaml` は、Renovate の docker-compose manager の既定の対象 (`compose` で始まる `.yaml`) なので、版の更新の PR が出ます ([Renovate の docker-compose manager](https://docs.renovatebot.com/modules/manager/docker-compose/))。
PostgreSQL の版は `packages/db/src/testing/connection.ts` の `postgresImage` (テストと型の生成) と、`compose.local.yaml` の 2 か所にあります。上げるときは両方を同じ版にします。ずれを止める検査は [Issue #515](https://github.com/yokozi-jp/agent-software-factory/issues/515) で扱います。

## この環境に入っていないもの

- OIDC の IdP。ワーカーは OIDC を使いません。API と web を手で動かす作業は [Issue #512](https://github.com/yokozi-jp/agent-software-factory/issues/512) で扱います。
- 保持期間 (`MessageRetentionPeriod`)。ElasticMQ では効きません ([ADR 0041](../adr/0041-standard-queue-per-task-with-dlq.md))。
- SES。ローカルは SMTP で Mailpit に送ります。
