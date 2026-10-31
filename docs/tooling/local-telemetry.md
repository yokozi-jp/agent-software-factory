---
type: Runbook
title: ローカルでトレースを見る
description: grafana/otel-lgtm を Docker で起動し、API のトレースを Grafana と Tempo の HTTP API で見る手順。API のトレースが出ないとき、遅いリクエストの原因をローカルで調べるとき、otel-lgtm の版を上げるときに読む。
tags: [tooling, runbook, observability, opentelemetry, docker]
---

# ローカルでトレースを見る

API のトレースを、手元の `grafana/otel-lgtm` (Grafana、Tempo、Loki、Prometheus、Collector が 1 つのイメージに入ったもの) で見る手順です。本番の送り先ではありません。計装の範囲と理由は [ADR 0048](../adr/0048-opentelemetry-traces-only-with-explicit-instrumentation.md) にあります。

## 起動する

```sh
docker compose -f compose.otel-lgtm.yaml up -d
```

起動に 30〜60 秒かかります。ポートはすべて `127.0.0.1` にだけ開きます。

| ポート | 用途                                                                      |
| ------ | ------------------------------------------------------------------------- |
| 3001   | Grafana (API の開発サーバーが 3000 を使うので 3001 に出す。admin / admin) |
| 4318   | OTLP/HTTP の受け口                                                        |
| 3200   | Tempo の HTTP API                                                         |
| 3100   | Loki の HTTP API                                                          |

別の worktree でも同じポートを使うので、一度に起動できるのは 1 つです。止めるのは `docker compose -f compose.otel-lgtm.yaml down` です。

## API を送り先につなぐ

`apps/api` の環境変数ファイル (`pnpm start` が `--env-file-if-exists` で読む `.env`) に書きます。

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
```

`OTEL_EXPORTER_OTLP_ENDPOINT` がない、または `OTEL_SDK_DISABLED=true` だと、SDK は始まりません。`vp dev` の入口 (`src/index.ts`) は SDK を始めないので、トレースを見るときは `vp build` したあと `pnpm start` で動かします。

## トレースを見る

Grafana の Explore で Tempo を選ぶか、HTTP API で検索します。Tempo は受け取ってから検索できるまでに十数秒かかります。

```sh
# service.name の一覧
curl -s http://127.0.0.1:3200/api/v2/search/tag/resource.service.name/values
# api のトレース (TraceQL)
curl -s -G http://127.0.0.1:3200/api/search --data-urlencode 'q={ resource.service.name = "api" }' --data-urlencode limit=5
# 1 本のトレースの span
curl -s http://127.0.0.1:3200/api/traces/<traceID>
```

ログは OTLP で送らないので、Loki には入りません。ログ行の `trace_id` を Tempo の `/api/traces/<traceID>` に渡して、トレースを開きます。

## 版を上げる

`compose.otel-lgtm.yaml` のイメージはタグとダイジェストで固定しています。Renovate が更新の PR を出します ([Renovate の docker-compose manager](https://docs.renovatebot.com/modules/manager/docker-compose/) は、`compose` で始まる名前の `.yaml` を既定で読む)。上げたら起動して、上の手順でトレースが出ることを確かめます。
