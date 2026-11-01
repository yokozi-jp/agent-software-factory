---
type: ADR
title: "ADR 0054: 共有の道具の package (ドライバ) を domain と infrastructure の 2 層に揃え、モジュールの infrastructure だけが import し、Effect は入れない"
description: db、hr-system、i18n、logging、telemetry を「ドライバ」と呼び、モジュールと同じ名前の層 domain と infrastructure (と testing/) に揃える決定。モジュールの application と http はドライバを import せず、infrastructure が Effect.tryPromise で包んで Port を実装する。ドライバは Promise を返し、effect を import せず、非同期の関数は AbortSignal を受け取る。入口のファイルは再 export だけにし、構成の違反を repo-policy と lint で止める。ADR 0051 が退けた「共有 package に層を入れる」を覆す理由、比べた案 (Effect を入れる、Adapter を package に分ける、ui と shared-kernel を含める)、ログインを実装するときに決め直すことを書く。ドライバを足す、変えるとき、ドライバの src/ にファイルを置くとき、モジュールがドライバを import したくなったとき、ドライバに Effect を入れたくなったときに読む。
tags: [adr, architecture, packages, drivers, clean-architecture, lint, effect]
---

# ADR 0054: 共有の道具の package (ドライバ) を domain と infrastructure の 2 層に揃え、モジュールの infrastructure だけが import し、Effect は入れない

[Issue #586](https://github.com/yokozi-jp/agent-software-factory/issues/586) で決めました。構成の正本は [package の構成](../domain-model/package-layout.md) です。

## 背景

モジュール (claim、approval、closing) は `domain`、`application`、`infrastructure`、`http` の層を持ち、層の方向と純粋さは Oxlint の規則が止めています ([ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md))。外部のシステムや道具を直接触る共有の package (db、hr-system、i18n、logging、telemetry) は層を持たず、入口の名前だけが `.`、`./node`、`./testing` でそろっていました ([ADR 0051](0051-shared-package-entries-by-feature.md))。中の置き場は package ごとにばらばらで、層の規則は届いていませんでした。

- hr-system は契約と ky の実装が `.` に同居していた。
- i18n の `test/__fixtures__/` は、lint の fixture と i18next-cli の入力の 2 つの意味を持っていた。
- ADR 0052 は「呼ぶモジュールの `infrastructure` が hr-system を包む」と決めたが、repo-policy の向きの検査はモジュールから hr-system への依存を許さなかった。

## 決定

- **ドライバ**: 外部のシステムや道具を直接触り、業務の規則を持たない共有の package です。クリーンアーキテクチャの Frameworks & Drivers の輪にあたります。対象は db、hr-system、i18n、logging、telemetry の 5 つで、一覧は repo-policy の `drivers.ts` にあります。shared-kernel (モジュールが合意して共有する業務のコード)、ui (shadcn が配置を決める)、module-fixtures は含めません。
- **層はモジュールと同じ名前**: ドライバの層は `domain` と `infrastructure` です。`application` と `http` は作りません。ドライバには自分の use case も route もないためです。中身のない層も作りません。名前をモジュールと同じにすると、`packages/*/src/<層>/**` の glob で作った今の層の規則 (層の方向、`domain` が外部ライブラリと Node.js の組み込みを import しないこと、`throw`、`Date`、`Math.random`) が、新しい規則なしでドライバにも届きます。
- **`testing/`**: テストの道具とフェイクを置きます。層ではありません。層のコードは `testing/` を import しません (テストは import できます)。`testing/` は Vitest と testcontainers を import するためです。
- **入口のファイルは再 export だけ**: `exports` が名前を挙げる `src/<名前>.ts` は、層のコードを再 export するだけです。`.` は `domain/` だけを再 export します (外部ライブラリを import しない契約。ADR 0051)。i18n は `infrastructure/` も再 export する例外です (i18next 1 つの薄い包みで、使うのは web だけ)。`./testing` は `testing/` を、それ以外 (`./node`、`./client`、`./seed`) は `infrastructure/` と `domain/` を再 export します。
- **モジュールの `infrastructure` だけがドライバを import する**: モジュールの `application` と `http` は、ドライバを import せず、`application` の Port (`Context.Service`) に依存します。`infrastructure` が、ドライバを `Effect.tryPromise` で包んで Port を実装します。`domain` は今のルールですべての外部ライブラリが止まっています。モジュールは `package.json` でドライバ (db を除く) に依存してよいことにします。db は ADR 0038 のとおり `apps/api` と `apps/worker` だけが依存します。
- **ドライバは `Promise` を返し、`effect` を import しない**: Effect の利点 (依存の注入、型付きの失敗、span、資源の後始末) は、モジュールの `infrastructure` がドライバを Service と Layer で包んだ所で得られます。Effect 4.0.6 に同梱の `AGENTS.md` と `ai-docs/src/01_effect/01_basics/10_creating-effects.ts` も、`Promise` の API を Service の実装の中で `Effect.tryPromise` で包む形です。ドライバを呼ぶ側には Effect の外にあるものが残ります (Better Auth の hook、migrator と Vitest の `globalSetup`、ブラウザ)。ドライバが Effect だけを返すと、そのすべてで実行の関数を呼ぶことになり、`Promise` の面と Effect の面の 2 つの入口を持つと、規則とテストが 2 つに増えます。
- **非同期の関数は `signal?: AbortSignal` を受け取る**: `Effect.tryPromise` は、Effect が中断されると `try: (signal) => …` に渡した `AbortSignal` を中断します (effect 4.0.6 の型は `readonly try: (signal: AbortSignal) => PromiseLike<A>`)。`AbortSignal` は Web 標準なので、Effect を import せずに受け取れます。ドライバは外部ライブラリ (ky、pg) に `signal` を渡し、モジュールの `infrastructure` は `tryPromise` の `signal` を渡します。hr-system のクライアントは、今回これに従いました。
- **ドライバは workspace のほかの package に依存しない**: 今の規則のままです。db は例外で、モジュールの型を `import type` で読みます (ADR 0038)。

## 止める仕組み

規則の一覧 (C1〜C5、M1〜M5、D1〜D7) と、規則ごとの仕組みは [package の構成](../domain-model/package-layout.md) が正本です。lint (層の規則と、禁止の表の `driver-in-module`、`driver-effect`、`testing-import`) と repo-policy (`drivers.ts`) が止め、Port の置き場と `signal` を渡すことの 2 つだけをレビューで見ます。

道具が決める置き場 (dbmate の `migrations/`、`openapi.yaml`、WireMock の `fake/`、i18next-cli の `locales/`) は動かさず、`drivers.ts` の `driverShapes` に package ごとに書きます。

## Considered Options

- **ドライバに Effect の Service と Layer を持たせる**: Effect の公式の例に近い書き方です。ただ、Effect でない呼び出し側が残り、不安定な module に乗る部分があります。effect 4.0.6 では `effect/http` の `HttpClient`、`effect/observability` の `OtlpTracer`、`effect/sql` が `@stability unstable` です。`Schema` は unstable 149 と experimental 46 の API を、`Logger` は unstable 3 を含みます。ログインで hr-system を呼ぶ処理を実装するときに、ログインを Effect で書くなら、包みのコードがログインと申請の `infrastructure` の 2 か所にできるので、hr-system に Effect の Service を持たせるかを決め直します。
- **Adapter を package に分ける (`packages/adapters/user-prisma` のような形)**: Adapter を package ごと差し替えられます。ただ、Adapter の package がモジュールの Port を import するので、ドライバが workspace に依存しない規則が崩れ、モジュール × 外部依存の数だけ project が増えます。ADR 0026 は「一緒に変わるものは分けない」(Nx の [Project Size](https://nx.dev/docs/kb/project-size)) を根拠に、層を project に分けませんでした。Adapter はモジュールの `infrastructure` に置き、ドライバだけを共有の package にします (判断)。
- **ドライバに `application` も作る**: ドライバには自分の use case がなく、手順は呼ぶ側か入口にあります。空の層になるので作りません。
- **共有 package に層を入れない (ADR 0051 の判断)**: ADR 0051 は、`db` と `i18n` は中身のほとんどが外部依存の薄い包みで、`domain` が空になるとして、層を入れる案を退けました。今回も、中身のない層は作りません。db は `domain` を持ちません。ただし、純粋な部分と外部ライブラリに触る部分が混ざる logging、telemetry、hr-system、i18n では、層の名前をモジュールと同じにすると今のルールが届くので、層に分けます。入口の切り方 (ADR 0051) は変えません。hr-system に `./client` を足すだけです。
- **ui と shared-kernel を含める**: ui の配置は shadcn の `components.json` が決めます (ADR 0034)。shared-kernel は業務のコードを共有するもので、外部システムを触る道具ではありません。

## Consequences

- hr-system の `exports` は `.` と `./client` です。`.` は型だけで ky を import しません。`./client` は ky の実装です。ky は Web 標準の `fetch` の上で動くので、ADR 0051 の規則 (`./node` は `process` や `node:*` を使う入口に限る) に従い、`./node` にはしません。
- db の `./seed` は `src/seed.ts`、`./testing` は `src/testing.ts` が入口です。seed の実装は `infrastructure/seed/` にあります。型の生成 (`testing/types.ts`) は testcontainers を使う開発の道具なので、`testing/` に置きます。
- i18n の `test/__fixtures__/` は `test/key-cases/` に改め、lint の fixture と名前を分けました。
- `vite.config.ts` の db、logging、telemetry の専用の override は、層の override より後ろに置き、`files` をファイル名から `src/infrastructure/**` と `src/testing/**` にしました。Oxlint は、同じファイルに同じ規則を設定した override のうち最後のものだけを使うので、前に置くと層の規則を消すためです (ADR 0026)。
- `domain/` のテストは Vitest を import するので、`vite-plus/test` だけを `domain` のテストの override で許します。
- モジュールが hr-system の `./client` を import できるように、`vite.config.ts` の `publicSubpaths` に `hr-system/client` を足しました。`driver-in-module` の pattern は、この否定の `group` より前に置きます (否定の `group` が一致すると、その import の検査が終わるため)。
- 機械で止まらないもの (Port の置き場、`signal` を渡すこと) は、[package の構成](../domain-model/package-layout.md) の「レビューで見ること」に書きます。

## 出典

- [ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md): 層と公開 API の規則。[ADR 0028](0028-effect-in-application-and-infrastructure.md): Effect を使う層。[ADR 0051](0051-shared-package-entries-by-feature.md): 入口の切り方。[ADR 0052](0052-hr-system-package-with-openapi-ky-and-wiremock.md): hr-system。
- Robert C. Martin, [The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) (2012): 4 つの輪と、依存は内向きだけの規則 (Dependency Rule)。ドライバの内側を層に分けることは決めていないので、層に分けるのはこのリポジトリの判断です。
- Effect 4.0.6 の `AGENTS.md` と `ai-docs/src/` (`node_modules/effect/`): Service と Layer で包む書き方と、`Effect.tryPromise` が `AbortSignal` を渡すこと (`src/Effect.ts` の `tryPromise` の型)。`@stability` の印は、各 module のソースにある (2026-11-02 に確かめた)。
