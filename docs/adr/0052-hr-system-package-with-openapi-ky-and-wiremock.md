---
type: ADR
title: "ADR 0052: 人事システムの契約、クライアント、フェイクは module ではない package packages/hr-system に置き、フェイクは WireMock を GenericContainer と Compose の両方で同じスタブから起動する"
description: 人事システムの OpenAPI を契約の正にして、ky のクライアントと WireMock のフェイクを packages/hr-system に置いた決定。package が module でない理由と exports、クライアントを Promise で書く理由、フェイクの起動方法（testcontainers 本体の GenericContainer と Compose が同じスタブとイメージを読む）、型の生成に pnpm dlx で TypeScript 5 を使う理由を書く。人事システムを呼ぶコードやフェイクのスタブを足す、変えるとき、外部システムのクライアントとフェイクの置き場を決めるとき、型の生成ツールを替えるときに読む。
tags: [adr, hr-system, openapi, wiremock, testcontainers, ky, packages]
---

# ADR 0052: 人事システムの契約、クライアント、フェイクは module ではない package packages/hr-system に置き、フェイクは WireMock を GenericContainer と Compose の両方で同じスタブから起動する

サンプル機能（経費精算）は、ログインと申請のときに人事システムを呼びます。タイムアウトと再試行の値は [ADR 0023](0023-ky-for-external-http-and-sdk-retries-for-aws.md) で決めましたが、契約、クライアント、フェイクをどこに置くかは決めていませんでした。経緯は [Issue #171](https://github.com/yokozi-jp/agent-software-factory/issues/171) にあります。

## 決定

- **置き場は `packages/hr-system`**: module ではありません（`moduleOrder` と `type:module` の印に入れず、層を持たず、他の workspace の package に依存しません）。人事システムは申請の module にも承認の module にも属さない外部システムで、ログイン（[Issue #156](https://github.com/yokozi-jp/agent-software-factory/issues/156)）と申請の両方が呼ぶためです。呼ぶ側が増えたときの依存の向きは、呼ぶ module が `dependencies` に足して決めます。`exports` は `.`（クライアントと `Employee` の型）だけです。フェイクとテストの道具は `test/` と `fake/` に置き、本番の入口には出しません。
- **契約の正は `openapi.yaml`（OpenAPI 3.1）**: 操作はメールアドレスで社員を引く、社員番号で上長を引く、の 2 つです。クライアントの型（`src/schema.gen.ts`）は openapi-typescript で作って commit し、フェイクのスタブの本文と path は unit test が OpenAPI に照らします。
- **クライアントは `Promise` を返し、Effect で包まない**: ADR 0028 の Effect は `application` と `infrastructure` の層のためのもので、この package に層はありません。呼ぶ module の `infrastructure` が `Effect.tryPromise` で包みます。404 は `null`、止まったときは ky のエラーを投げます。
- **テナントは接続先の base URL で分ける**: フェイクは `/<tenant_id>/…` の接頭辞で返し分けます。
- **フェイクは WireMock のイメージを版とダイジェストで固定し、`compose.local.yaml` の 1 か所に置く**: testcontainers も同じ行を読みます。スタブは `fake/mappings` の 1 か所で、testcontainers と Compose の両方が読みます。Node 向けの WireMock 専用の Testcontainers モジュール（v0.0.1）は使わず、testcontainers 本体の `GenericContainer` で起動します。コンテナは Vitest の `globalSetup` で 1 回の実行につき 1 回起動し、手元は `withReuse()` で使い回します。
- **型の生成は `pnpm dlx` で TypeScript 5 と openapi-typescript を一時的に入れて流す**: openapi-typescript は TypeScript 5 の JS API（`ts.factory`）を呼びますが、このリポジトリの TypeScript 7 には無く、`@hey-api/openapi-ts` も同じです。peer を TypeScript 5 に差し替える `overrides` と `packageExtensions` は、pnpm 12 で効きませんでした。この方法は lockfile と catalog の外にあり、Renovate が版を上げません。openapi-typescript が TypeScript 7 に対応したら catalog に入れて `dlx` をやめます（[Issue #562](https://github.com/yokozi-jp/agent-software-factory/issues/562)）。

## Considered Options

- **module にする**: 層（`domain` など）が空になり、`moduleOrder` の向きに無理に当てはめることになります。
- **各 module の `infrastructure` にクライアントを置く**: ログインと申請の両方が呼ぶので、契約とフェイクが 2 か所になります。
- **`shared-kernel` に置く**: `shared-kernel` は module が共有するコードで、外部システムの契約とコンテナの道具を入れると入口の切り方（ADR 0051）を崩します。
- **MSW、Prism、Hono の自前のフェイクにする**: 比較は [Issue #71](https://github.com/yokozi-jp/agent-software-factory/issues/71) で行い、遅延、接続断、状態のシナリオ、受けた要求の検証を持つ WireMock を選びました。

## Consequences

- 人事システムの操作を足すときは、`openapi.yaml`、`pnpm --filter @agent-software-factory/hr-system generate`、スタブ、unit test を同じ変更で直します（[人事システムのフェイク](../tooling/hr-system-fake.md)）。
- 生成した型が `openapi.yaml` と合うことを、CI はまだ確かめません（Issue #562 で扱います）。
