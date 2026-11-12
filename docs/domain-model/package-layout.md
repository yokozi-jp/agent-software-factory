---
type: Convention
title: package の構成 (モジュールとドライバ)
description: packages/ の package を、業務の機能を持つモジュールと、外部のシステムを触るドライバの 2 つの型に揃える規約。src/ に置ける名前、層の名前、入口のファイルの書き方、ドライバごとの構成、規則ごとに止める仕組み (lint、repo-policy、レビュー) をまとめる。package の src/ にファイルを置くとき、ドライバを足す、変えるとき、モジュールからドライバを使うとき、repo-policy や lint が構成で止めたときに読む。
tags: [domain-model, convention, packages, drivers, clean-architecture, repo-policy, lint]
---

# package の構成 (モジュールとドライバ)

`packages/` の package は、**モジュール**か**ドライバ**のどちらかの型に揃えます。型から外れた置き方は、repo-policy か lint が止めます。決定と理由は [ADR 0054](../adr/0054-drivers-with-domain-and-infrastructure-layers.md) にあります。この文書は、レビュアーとエージェントが参照する正本です。

- **モジュール**: 業務の機能を持つ package (claim、approval、closing)。`type:module` の tag を持つ。
- **ドライバ**: 外部のシステムや道具を直接触り、業務の規則を持たない共有の package (db、hr-system、i18n、logging、telemetry)。クリーンアーキテクチャの Frameworks & Drivers の輪にあたる。`type:driver` の tag を持ち、`drivers.ts` の `driverShapes` にも名前が要る (片方だけだと repo-policy が止める)。
- どちらでもない package は shared-kernel (`type:shared-kernel`。モジュールが共有する業務のコード)、ui (`type:ui`。shadcn が配置を決める)、module-fixtures (`type:fixtures`。lint の fixture) で、この規約の対象外です。役割の tag は [module ではない package を足す手順](add-package.md) にあります。

## 依存の向き

```text
apps/*  (ManagedRuntime と Layer を組み立てる)
 ├─→ モジュール: http / infrastructure ─→ application ─→ domain
 │                     infrastructure ─→ ドライバ  (モジュールで import できるのはここだけ)
 └─→ ドライバ:   infrastructure ─→ domain
```

## 規則

「仕組み」の列が「レビュー」の規則だけが、機械では止まりません。

| #   | 規則                                                                                                                                                                               | 仕組み                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| C1  | 層の名前は `domain`、`application`、`infrastructure`、`http` だけ                                                                                                                  | repo-policy                                                                             |
| C2  | 層は内向きにだけ依存する                                                                                                                                                           | lint (`layers`)                                                                         |
| C3  | `domain` は外部ライブラリ、Node.js の組み込み、`throw`、`Date`、`Math.random` を使わない                                                                                           | lint (`layers`、`domain` の純粋さ)                                                      |
| C4  | 層のコードは `testing/` を import しない (テストは import できる)                                                                                                                  | lint (禁止の表 `testing-import`)                                                        |
| C5  | 道具が決める置き場は動かさず、`drivers.ts` の `driverShapes` に書く                                                                                                                | repo-policy                                                                             |
| M1  | モジュールの `src/` に置けるのは、`index.ts`、層のディレクトリ、`__fixtures__/` だけ                                                                                               | repo-policy                                                                             |
| M2  | Effect は `application` と `infrastructure` だけで使い、安定した API だけを使う                                                                                                    | lint、effect-tsgo ([ADR 0028](../adr/0028-effect-in-application-and-infrastructure.md)) |
| M3  | ドライバを import できるのはモジュールの `infrastructure` だけ。`application` と `http` は止める                                                                                   | lint (禁止の表 `driver-in-module`)                                                      |
| M4  | モジュールは `package.json` でドライバ (db を除く) に依存してよい                                                                                                                  | repo-policy (`modulesDependOneWay`)                                                     |
| M5  | Port は `application` に `Context.Service` で置き、実装は `infrastructure` に Layer で置く                                                                                         | レビュー                                                                                |
| M6  | Hono (`hono`、`@hono/*`) を import できるのは `http` と、`apps/api` の `src/http/`、`app.ts`、`server.ts` だけ。route は `http/route/` に sub-app として置く                       | lint (禁止の表 `hono`)                                                                  |
| D1  | ドライバの層は `domain` と `infrastructure` だけ。`application` と `http` は作らない。中身のない層も作らない                                                                       | repo-policy                                                                             |
| D2  | ドライバの `src/` に置けるのは、入口のファイル、`domain/`、`infrastructure/`、`testing/`、`__fixtures__/`、C5 の置き場だけ                                                         | repo-policy                                                                             |
| D3  | 入口のファイルは再 export だけを書く (型の augmentation を届ける `import type {} from "./…"` も書ける)                                                                             | repo-policy                                                                             |
| D4  | 入口ごとの再 export の元: `.` は `domain/` だけ (i18n は `infrastructure/` も)。`./testing` は `testing/`。ほか (`./node`、`./client`、`./seed`) は `infrastructure/` と `domain/` | repo-policy                                                                             |
| D5  | ドライバは `effect` を import せず、`package.json` にも書かない                                                                                                                    | lint (禁止の表 `driver-effect`)、repo-policy                                            |
| D6  | ドライバは workspace のほかの package に依存しない (db が `import type` でモジュールを読むことを除く)                                                                              | repo-policy                                                                             |
| D7  | ドライバの非同期の関数は `Promise` を返し、`signal?: AbortSignal` を受け取って外部ライブラリに渡す                                                                                 | レビュー                                                                                |

## モジュールの構成

```text
packages/<モジュール>/
├── package.json
├── tsconfig.json
├── events/                 # このモジュールが送るイベントのスキーマ (入れ子の package)
└── src/
    ├── index.ts            # 公開 API
    ├── domain/
    ├── application/        # Port (Context.Service)
    ├── infrastructure/     # Port の実装 (Layer)。ドライバを包む
    ├── http/               # Hono を import できる層。route/ に sub-app を置く
    └── __fixtures__/       # lint の fixture だけ
```

## ドライバの構成

```text
packages/<ドライバ>/
├── package.json、tsconfig.json、vite.config.ts
├── <道具が決める置き場>       # C5 の表 (下) に書いたものだけ
├── test/                     # Vitest の globalSetup とコンテナの起動、検査の入力
└── src/
    ├── index.ts              # `.`        domain/ の再 export だけ
    ├── <node|client|seed>.ts # 実装の入口  infrastructure/ と domain/ の再 export だけ
    ├── testing.ts            # `./testing` testing/ の再 export だけ
    ├── domain/               # 純粋。外部ライブラリなし
    ├── infrastructure/       # 外部ライブラリを触る。CLI の処理もここに置く
    ├── testing/              # テストの道具とフェイク
    └── __fixtures__/         # lint の fixture だけ
```

- 層の中の `*.test.ts` は、対象のファイルの隣に置きます。層のテストは `testing/` を import できます。
- `domain/` のテストは、`vite-plus/test` だけを import できます。ほかの外部ライブラリは止まります。
- `application` を作らない理由は、ドライバには use case がなく、手順は呼ぶ側か入口にあるためです。

### ドライバごとの入口と置き場

| ドライバ  | 入口 (`exports`)                           | 道具が決める置き場 (C5)                                     |
| --------- | ------------------------------------------ | ----------------------------------------------------------- |
| db        | `./node`、`./seed`、`./testing` (`.` なし) | root: `bootstrap.sql`、`migrations/`、`templates/`、`test/` |
| hr-system | `.` (型)、`./client` (ky の実装)           | root: `openapi.yaml`、`fake/`、`test/`                      |
| i18n      | `.` (domain と infrastructure の再 export) | root: `i18next.config.ts`、`test/`。`src/`: `locales/`      |
| logging   | `.`、`./node`、`./testing`                 | なし                                                        |
| telemetry | `.`、`./node`                              | なし                                                        |

db に `domain/` はありません。カタログの検査は `Queryable` を通して DB に問い合わせるので、純粋ではないためです。型の生成 (`testing/types.ts`) は testcontainers を使う開発の道具なので `testing/` に置きます。

## モジュールがドライバを使うとき

1. `application` に、業務の言葉で Port を宣言する (`Context.Service`)。ドライバの型は Port に漏らさない。
2. `infrastructure` にドライバを import し、`Effect.tryPromise` で包んで Port を実装する。`tryPromise` の `try: (signal) => …` の `signal` をドライバの関数に渡し、Effect の中断で外部の呼び出しも止める (D7)。
3. `package.json` の `dependencies` にドライバを `workspace:*` で足す。
4. `apps/*` の入口が、ドライバのインスタンスを作って `Layer` に渡す。

## レビューで見ること

機械では止まらない規則です。

- **M5**: Port が `application` にあり、業務の言葉で書かれているか。ドライバの型 (`Employee` のような外部システムの形) を Port の公開の型に使っていないか。`Layer` が `infrastructure` にあるか。
- **D7**: ドライバの非同期の関数が `signal` を受け取り、外部ライブラリ (ky の `signal`、pg の問い合わせ) に渡しているか。中断のテストがあるか (hr-system の `client.test.ts` が例)。
- **ドライバの追加**: 新しいドライバは、`drivers.ts` の `driverShapes` と `modules.ts` の `ownExports` に足したか。[module ではない package を足す手順](add-package.md) に従ったか。
