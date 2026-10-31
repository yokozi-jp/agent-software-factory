---
type: Runbook
title: 人事システムのフェイク
description: 人事システムの OpenAPI、ky のクライアント、WireMock のフェイク (packages/hr-system) の置き場、フェイクを testcontainers と Docker Compose の両方から起動する方法、スタブを足す手順、型を作り直す手順、WireMock の版を上げる手順。人事システムを呼ぶコードを書くとき、スタブを足す・変えるとき、OpenAPI を変えるとき、WireMock のイメージの版を上げるとき、フェイクの起動が遅い・失敗するときに読む。
tags: [tooling, runbook, hr-system, wiremock, testcontainers, openapi, ky]
---

# 人事システムのフェイク

サンプル機能（経費精算）は、ログインと申請のときに人事システムを呼びます。本物にはつながず、リポジトリの中の WireMock のフェイクを相手にします。経緯は [Issue #171](https://github.com/yokozi-jp/agent-software-factory/issues/171)、タイムアウトと再試行の値は [ADR 0023](../adr/0023-ky-for-external-http-and-sdk-retries-for-aws.md) です。

## 置き場

すべて `packages/hr-system` にあります。module ではない package で、他の workspace の package に依存せず、どの module も、まだ依存していません。

| 物                 | 場所                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 契約（正）         | `openapi.yaml`。操作は、メールアドレスで社員を引く `GET /employees?email=` と、社員番号で上長を引く `GET /employees/{employeeNumber}/manager` の 2 つ |
| クライアントの型   | `src/schema.gen.ts`（`openapi.yaml` から作る。手で直さない）                                                                                          |
| クライアント       | `src/index.ts` の `createHrSystemClient({ baseUrl })`                                                                                                 |
| フェイクのスタブ   | `fake/mappings/*.json`（testcontainers と Compose の両方が、このディレクトリを読む）                                                                  |
| フェイクのイメージ | `compose.local.yaml` の `hr-system-fake`（テストもここから版を読む）                                                                                  |

テナントは接続先の base URL で分けます。クライアントは `baseUrl` に `http://<host>:<port>/<tenant_id>` を受け、フェイクは `/<tenant_id>/…` の接頭辞を問わず同じ社員を返します。本番では、テナントごとの設定の URL を渡します。

クライアントは、404 を `null` で返し（再試行しない）、人事システムが止まったとき（タイムアウト、接続断、再試行しても 5xx）は ky のエラー（`HTTPError`、`TimeoutError`、`NetworkError`）を投げます。ログインも申請も失敗にするのは、呼んだ側です。

## 手で起動する

```sh
docker compose -f compose.local.yaml up -d --wait hr-system-fake
curl 'http://127.0.0.1:9080/tenant-a/employees?email=taro.yamada@example.com'
docker compose -f compose.local.yaml down
```

| メールアドレス              | 社員番号 | 在籍 | 経理の役割 | 上長          |
| --------------------------- | -------- | ---- | ---------- | ------------- |
| `taro.yamada@example.com`   | E0001    | ある | ない       | E0002         |
| `hanako.suzuki@example.com` | E0002    | ある | ない       | いない（404） |
| `keiri@example.com`         | E0003    | ある | ある       | E0002         |
| `retired@example.com`       | E0099    | ない | ない       | いない（404） |

ほかのメールアドレスは 404 です。

## テストで起動する

`packages/hr-system/test/global-setup.ts` が、Vitest の `globalSetup` で 1 回の実行につき 1 回だけ起動し、`project.provide("hrSystemFakeOrigin", …)` で渡します。テストは `inject("hrSystemFakeOrigin")` で読みます。Node 向けの WireMock 専用の Testcontainers モジュール（v0.0.1）は使わず、testcontainers 本体の `GenericContainer` で起動します。

- 手元は `withReuse()` で使い回します。コンテナは実行が終わっても残ります（`docker rm -f` で消す）。`TESTCONTAINERS_REUSE_ENABLE=false` で使い回しを止められます。`CI` が設定された環境は、毎回新しく起動し、終わりに止めます。
- スタブは bind mount で読むので、使い回しても `/__admin/reset` でファイルの最新に戻ります。
- テストの間は `/__admin/reset` で状態（足したスタブ、シナリオの状態、受けた要求の記録）を消し、テナントの接頭辞をテストごとに変えます。1 つのファイルの中のテストは順に走るので、reset は他のテストを壊しません。ファイルを増やして並列に走らせるときは、reset を `beforeEach` から外し、接頭辞だけで分けます。
- 遅延、接続断、状態のシナリオのような、テスト固有の振る舞いは、テストが `test/wiremock.ts` の `addStub` で足します。ファイルのスタブは、手で動かす環境と、どのテストも使う社員だけにします。

起動の時間（2026-10-31、WSL、イメージは取得済み。1 つのテストだけを流した実行全体の時間）。

| 場合                             | 実行全体  |
| -------------------------------- | --------- |
| コンテナがない（手元の初回、CI） | 約 3.9 秒 |
| 使い回し（手元の 2 回目から）    | 約 0.9 秒 |

`docker compose up -d --wait` は約 3.8 秒です。CI の値は PR に書きます。

## スタブを足す・変える

1. `fake/mappings/` に WireMock の mapping の JSON を 1 ファイル足します。1 ファイルに 1 つの mapping です。
2. 応答の本文を、`openapi.yaml` の schema に合わせます。`src/fake.unit.test.ts` が、全スタブの要求の path が OpenAPI の path に当たることと、本文が `Employee` の schema に合うことを確かめます。
3. 上の表を直します。

## OpenAPI を変えて型を作り直す

```sh
pnpm --filter @agent-software-factory/hr-system generate
```

`openapi-typescript` は TypeScript 5 の JS API を呼びますが、このリポジトリの TypeScript 7 にはその API がありません。そこで `generate` は、`pnpm dlx` で `openapi-typescript@7.13.0` と `typescript@5.9.3` を一時的に入れて流します。`schema.gen.ts` の差分を commit します。`openapi-typescript` が TypeScript 7 に対応したら、catalog に入れて `dlx` をやめます。

## 版を上げる

WireMock のイメージは `compose.local.yaml` の 1 か所で、版とダイジェストを固定しています。Renovate が上げます。テストも同じ行を読むので、他に直す場所はありません。上げた後は `pnpm --filter @agent-software-factory/hr-system test` を流します。
