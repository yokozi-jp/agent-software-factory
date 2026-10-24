# HTTP の外部システムのフェイクの道具を比べる

## 問い

[Issue #71](https://github.com/yokozi-jp/agent-software-factory/issues/71) の調査。サンプル機能（経費精算）の人事システムは HTTP の API で、申請のときに上長を問い合わせる。この人事システムのフェイクにする道具として、WireMock（Docker、Testcontainers の GenericContainer）、MSW、Prism（OpenAPI から）、Hono で書く自前のフェイクを比べる。観点は次のとおり。

- ローカルの起動、結合テスト（Vite+ のテスト）、E2E で同じスタブを使えるか
- 遅延、エラー、接続断を注入できるか（タイムアウトと再試行のテストのため）
- 状態を持つシナリオと、受けたリクエストの検証ができるか
- スタブを型や OpenAPI と食い違わないように保てるか
- 版と保守の状況
- テナントの `tenant_id` を、リクエストごとに区別して返せるか

前提は [サンプル機能の題材と範囲を決める](https://github.com/yokozi-jp/agent-software-factory/issues/26) の解決のコメント。調べた日は 2026-10-24。Node.js は v26.12.1、Docker は 29.9.1。

## 要約

- 3 つの場面（ローカルの起動、Vite+ のテスト、E2E）で同じスタブを使えるのは、別のプロセスで動くもの（WireMock、Prism、Hono の自前のフェイク、MSW のハンドラーを `@msw/serve` でサーバーにしたもの）。MSW の `setupServer` は同じプロセスの中の通信だけを横取りするため、API が別のプロセスで動く E2E とローカルの起動には、そのままでは使えない。
- 遅延と接続断の注入が一番そろうのは WireMock（固定と乱数の遅延、少しずつ返す遅延、接続のリセットなど 4 種の fault）。MSW は `delay()` とネットワークエラー（`HttpResponse.error()`）を返せる。Prism には遅延の機能がなく、要望の Issue #1140 は not planned で閉じられ、別のプロキシ（toxiproxy など）を使うよう案内されている。
- 状態のシナリオと受けたリクエストの検証は、WireMock が設定（JSON）と管理 API で持つ。MSW はハンドラーのコードで状態を書き、リクエストの検証は公式が「避ける」よう勧める。Prism には状態の機能がない。Hono の自前のフェイクは全部を自分で書く。
- OpenAPI との一致は Prism が一番強い（OpenAPI 3.1 を読み、仕様に合わないリクエストに 422 を返す）。MSW は型引数、`openapi-msw`（openapi-typescript の型）、`@msw/source` の `fromOpenApi()` で寄せられる。WireMock のオープンソース版には OpenAPI の検証がなく、それは有料の WireMock Cloud の機能。
- 版: WireMock の安定版は 3.13.2（2025-11-14）のままで、4.0.0 は beta.41（2026-10-21）まで来ている。Node 向けの WireMock の Testcontainers モジュールは v0.0.1（2024-05-09、testcontainers ^10 に依存）から更新がない。testcontainers 本体は 12.2.1（2026-10-13）。MSW は 3.0.3（2026-10-10、ESM だけ、Node.js 22 以上、Node.js 26 対応を明記）。Prism は 5.16.0（2026-07-17）だが、Docker Hub のイメージは 5.15.10 止まりで、既定の設定では起動に失敗した（実験）。
- テナントの返し分けは、WireMock（ヘッダーの一致と応答のテンプレート）、MSW、Hono の自前のフェイク（コード）でできる。Prism はリクエストの値で応答を選べず、クライアントが `Prefer: example=...` を送る必要がある。
- 判断: 第一候補は WireMock の Docker イメージ 3.13.2 を版で固定し、testcontainers 本体の `GenericContainer` で起動する案。次点は Hono の自前のフェイク。Prism は主役にせず、OpenAPI との食い違いを見つける補助に使える。決めるのは [外部システムのフェイクと CSV を置く先を決める](https://github.com/yokozi-jp/agent-software-factory/issues/75)。

## 比較

| 観点                   | WireMock（Docker）                             | MSW                                                     | Prism                                          | Hono の自前のフェイク                                                       |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| 動き方                 | 別のプロセスの HTTP サーバー（Java）           | 同じプロセスで横取り。`@msw/serve` でサーバーにもできる | 別のプロセスの HTTP サーバー（Node.js の CLI） | 別のプロセスの HTTP サーバー。同じプロセスで `app.fetch` を呼ぶこともできる |
| 3 つの場面で同じスタブ | できる                                         | `@msw/serve` を足せばできる                             | できる                                         | できる                                                                      |
| 遅延                   | 固定、乱数（lognormal、uniform）、少しずつ返す | `delay(ms)`、`delay('infinite')`                        | 機能なし                                       | 自分で書く                                                                  |
| エラーの応答           | 任意の status                                  | 任意の status                                           | `Prefer: code=503` で仕様にある status         | 任意の status                                                               |
| 接続断                 | `CONNECTION_RESET_BY_PEER` など 4 種           | `HttpResponse.error()`（ネットワークエラー）            | 機能なし                                       | Node.js の socket を直接壊す（Node.js 固有の API）                          |
| 状態のシナリオ         | scenario（状態機械）、管理 API でリセット      | ハンドラーの変数、`server.use()` で上書き               | 機能なし                                       | 自分で書く                                                                  |
| 受けたリクエストの検証 | request journal、件数、unmatched、near miss    | 公式は避けるよう勧める。life-cycle events で見られる    | ログだけ                                       | 自分で書く                                                                  |
| OpenAPI と型           | オープンソース版は検証なし（Cloud の機能）     | 型引数、`openapi-msw`、`@msw/source`                    | OpenAPI そのもの。リクエストを検証して 422     | TypeScript の型、`@hono/zod-openapi`                                        |
| テナントの返し分け     | ヘッダーの一致、テンプレート                   | コード                                                  | できない（`Prefer` が要る）                    | コード                                                                      |
| 最新の版               | 3.13.2（安定、2025-11-14）、4.0.0-beta.41      | 3.0.3（2026-10-10）                                     | 5.16.0（2026-07-17）、Docker は 5.15.10        | Hono 4.13.13、`@hono/node-server` 2.1.5（リポジトリで使用中）               |
| 新しい依存             | Docker イメージ、testcontainers                | msw（と `@msw/serve`）                                  | `@stoplight/prism-cli` か Docker イメージ      | なし                                                                        |

## 3 つの場面で同じスタブを使えるか

- WireMock の Docker イメージは、`/home/wiremock` の下の `mappings` と `__files` からスタブを読む。ディレクトリを mount するかコピーすれば、同じ JSON をどこでも使える（[wiremock-docker の README](https://github.com/wiremock/wiremock-docker)）。
- Vite+ のテストでは、testcontainers の `GenericContainer` でイメージを起動し、`withCopyDirectoriesToContainer` で mappings を入れられる（[Testcontainers for Node.js: Containers](https://node.testcontainers.org/features/containers/)）。起動は Vitest の `globalSetup` で一度だけ行い、ポートを `project.provide()` でテストに渡し、テストは `inject()` で受ける（[Vitest: globalSetup](https://vitest.dev/config/globalsetup)）。
- E2E では、Playwright の `webServer` に配列で複数のサーバーを渡して起動できる（[Playwright: Web server](https://playwright.dev/docs/test-webserver)）。フェイクの起動もここに並べられる。ローカルの起動では docker compose か同じコマンドで立てる（判断）。
- MSW の `setupServer` は、それを呼んだ Node.js のプロセスの通信を制御する（[MSW: Node.js integration](https://mswjs.io/docs/integrations/node)）。Vite+ のテストで Hono のアプリを同じプロセスで呼ぶなら、アプリが外へ出す `fetch` を横取りできる。API が別のプロセスで動く E2E とローカルの起動では、そのプロセスの入口で `server.listen()` を呼ぶ必要がある。
- MSW のハンドラーは `@msw/serve`（0.11.0、2026-09-28。旧名は `@mswjs/http-middleware`）で単独の HTTP サーバーにでき、Hono のサーバーにミドルウェアとして載せることもできる。ただし公式は「モックにはまず MSW を直接使う。単独のモックサーバーはリクエストの URL を変える必要があり、準備が増え、遅く、モックのために本物のサーバーを保守することになる」と注意し、Docker の構成などを正当な用途に挙げている（[MSW: Serve](https://mswjs.io/ecosystem/serve)、[mswjs/http-middleware の README](https://github.com/mswjs/http-middleware)）。
- Prism は CLI で動く HTTP サーバーで、テストの中でプログラムから使う道具ではないと公式が書いている（[Prism: Concepts](https://github.com/stoplightio/prism/blob/master/docs/getting-started/02-concepts.md)）。別のプロセスとして立てれば 3 つの場面で同じ OpenAPI を使える。
- Hono の自前のフェイクは `@hono/node-server` の `serve()` で別のプロセスにでき（[honojs/node-server の README](https://github.com/honojs/node-server)）、テストでは `app.request()` や `testClient()` で同じプロセスから呼べる（[Hono: Testing Helper](https://hono.dev/docs/helpers/testing)、[Hono: Testing](https://hono.dev/docs/guides/testing)）。

## 遅延、エラー、接続断の注入

### WireMock

- スタブごとの固定の遅延（`fixedDelayMilliseconds`）、全体の固定の遅延（`/__admin/settings`）、乱数の遅延（lognormal と uniform。lognormal の `maxValue` は 3.13.0 から）、本文を分けて少しずつ返す遅延（`chunkedDribbleDelay`）がある（[WireMock: Simulating Faults](https://wiremock.org/docs/simulating-faults/)）。
- fault は `EMPTY_RESPONSE`、`MALFORMED_RESPONSE_CHUNK`、`RANDOM_DATA_THEN_CLOSE`、`CONNECTION_RESET_BY_PEER` の 4 種。`CONNECTION_RESET_BY_PEER` は *nix でだけ正しく動き、Windows では接続が止まることが多いと書かれている（同）。
- 実験: `wiremock/wiremock:3.13.2` を Docker で起動し、Node.js 26 の `fetch` から呼んだ。3 秒の固定の遅延に `AbortSignal.timeout(500)` を付けると `TimeoutError` になった。`CONNECTION_RESET_BY_PEER` は `TypeError: fetch failed`（cause の code は `UND_ERR_SOCKET`）になった。イメージの Java は 17.0.19。

### MSW

- `delay(ms)` で遅延を入れ、`delay('infinite')` で応答を返さずにタイムアウトを試せる。引数なしの `delay()` の現実的な遅延は Node.js では無効になる（[MSW: delay](https://mswjs.io/docs/api/delay)）。
- `HttpResponse.error()` は `Response.error()` と同じネットワークエラーを返す。エラーの中身は変えられない（[MSW: HttpResponse](https://mswjs.io/docs/api/http-response)）。
- 3.0.0 から、テストランナーの偽のタイマーを避けるための `setTimeout` の差し替えをやめた。偽のタイマーを使うテストでは、遅延した応答を得るのにタイマーを進める必要がある（[MSW v3.0.0 のリリース](https://github.com/mswjs/msw/releases/tag/v3.0.0)）。
- 実験: msw 3.0.3 を Node.js 26 で動かした。`delay('infinite')` に `AbortSignal.timeout(500)` で `TimeoutError`、`HttpResponse.error()` で `TypeError: fetch failed` になった。接続のリセットとネットワークエラーの区別は付けられない。

### Prism

- 応答の status は `Prefer: code=404` のヘッダーか `__code` のクエリで選べる（[Prism: CLI](https://github.com/stoplightio/prism/blob/master/docs/getting-started/03-cli.md)）。選べるのは OpenAPI に書いた応答。実験でも `Prefer: code=503` で 503 が返った。
- 応答の遅延の要望（[#1140](https://github.com/stoplightio/prism/issues/1140)）は 2023-05-05 に not planned で閉じられた。保守者は nginx のモジュールや toxiproxy などの別の道具を勧めている（同 Issue のコメント）。接続断の機能も文書にない。

### Hono の自前のフェイク

- 遅延とエラーの status はふつうのコードで書ける。
- 接続断は Web 標準の API では書けない。`@hono/node-server` では `c.env.incoming`（Node.js の `IncomingMessage`）に届くので、その socket を壊す形になる（[honojs/node-server の README](https://github.com/honojs/node-server) の Accessing Node.js API）。
- 判断: フェイクは `apps/api` のアプリのコードではないので、ADR 0007（アプリのコードは Web 標準の API だけで書く）の対象の外に置ける。置き場所を `apps/api` の外にすれば食い違わない。

## 状態のシナリオと受けたリクエストの検証

### WireMock

- scenario は状態機械で、スタブを状態で選び、応答のあとに状態を進められる。`GET /__admin/scenarios` で状態を読み、`POST /__admin/scenarios/reset` で戻し、`PUT /__admin/scenarios/{name}/state` で任意の状態にできる（[WireMock: Stateful Behaviour](https://wiremock.org/docs/stateful-behaviour/)）。
- 受けたリクエストはメモリの request journal に残る。`POST /__admin/requests/count` で条件に合う件数を数え、`/__admin/requests/find` で探し、`/__admin/requests/unmatched` でどのスタブにも合わなかったものを取れる。合わなかったときは近いスタブ（near miss）を返す（[WireMock: Verifying](https://wiremock.org/docs/verifying/)）。
- 実験: 1 回目に 503、2 回目に 200 を返す scenario で再試行の流れを再現できた。テナントのヘッダーを付けたリクエストの件数は 1 と数えられ、ヘッダーのないリクエストは unmatched に 1 件残り、404 の本文に「Header is not present」と近いスタブの差分が出た。

### MSW

- 状態はハンドラーのコード（変数）で持つ。テストごとの上書きは `server.use()` で行い、`server.resetHandlers()` で戻す（[MSW: server.use()](https://mswjs.io/docs/api/setup-server/use)、[MSW: Network behavior overrides](https://mswjs.io/docs/best-practices/network-behavior-overrides)）。
- 公式は、横取りしたリクエストへのアサーション（呼ばれたか、URL や本文が正しいか）を実装の詳細のテストとして強く勧めない。代わりに、ハンドラーが正しくないリクエストにエラーを返すように書き、アプリの反応をテストする。未知のリクエストは `onUnhandledFrame: 'error'` で失敗させる。アプリに表れない一方向のリクエストだけは life-cycle events で直接見てよい（[MSW: Avoid request assertions](https://mswjs.io/docs/best-practices/avoid-request-assertions)）。
- `onUnhandledRequest` は 3.0.0 で `onUnhandledFrame` に名前が変わった（[MSW v3.0.0 のリリース](https://github.com/mswjs/msw/releases/tag/v3.0.0)）。実験でも、ハンドラーのない URL は `[MSW] Error: intercepted a request without a matching request handler` を出し、`fetch` は失敗した。

### Prism

- 応答は OpenAPI の example か schema から作る。example は `Prefer: example=<名前>` で選び、`-d` で schema から動的に作る（[Prism: Mocking](https://github.com/stoplightio/prism/blob/master/docs/guides/01-mocking.md)）。前の呼び出しで応答を変える状態の機能は文書にない。
- 受けたリクエストを検証する API はなく、検証は OpenAPI に照らした妥当性の検査（下の節）に限られる。

## 型と OpenAPI との一致

- Prism は OpenAPI v3.1、v3.0、v2.0 と Postman Collection を読む（[Prism の README](https://github.com/stoplightio/prism)）。リクエストを仕様で検証し、合わなければ RFC 7807 の 422 を返す（[Prism: Errors](https://github.com/stoplightio/prism/blob/master/docs/guides/06-errors.md)）。実験でも、必須の `X-Tenant-Id` のないリクエストに `Request header must have required property 'x-tenant-id'` の 422 が返った。
- Prism には validation proxy があり、本物の API の前に置いてリクエストと応答が仕様に合うかを報告する。`--errors` で違反を 422 にする（[Prism: Concepts](https://github.com/stoplightio/prism/blob/master/docs/getting-started/02-concepts.md)、[Prism: CLI](https://github.com/stoplightio/prism/blob/master/docs/getting-started/03-cli.md)）。
- MSW のハンドラーは型引数（パスのパラメーター、リクエストの本文、応答の本文、パス）で型を絞れる（[MSW: TypeScript](https://mswjs.io/docs/best-practices/typescript)）。`openapi-msw`（2.1.0、2026-09-30）は openapi-typescript が作る `paths` の型から MSW のハンドラーの型を推論し、MSW v2 と v3 に対応する（[openapi-msw の README](https://github.com/christoph-fricke/openapi-msw)）。
- `@msw/source`（0.7.0、2026-09-28）の `fromOpenApi()` は OpenAPI 2.0 と 3.0 の文書からハンドラーを作る。応答は `example`、なければ schema から作り、200 の応答がなければ固定の 504 を返す（[MSW Source: OpenAPI](https://github.com/mswjs/mswjs.io/blob/main/src/content/ecosystem/source/integrations/open-api.md)、[fromOpenApi](https://github.com/mswjs/mswjs.io/blob/main/src/content/ecosystem/source/api/from-open-api.md)）。3.1 への対応は文書に書かれていない。
- WireMock のオープンソース版の文書は、OpenAPI でスタブを検証する機能を WireMock Cloud に案内している（[WireMock: Verifying](https://wiremock.org/docs/verifying/) の冒頭）。第三者の拡張（例: [dimabarbul/wiremock-openapi-validation-extension](https://github.com/dimabarbul/wiremock-openapi-validation-extension)）はあるが、小さな個人の repository。
- Hono の自前のフェイクは TypeScript なので、openapi-typescript の型を `satisfies` で当てるか、`@hono/zod-openapi`（1.6.3）でルートから OpenAPI を作れる（判断。npm の版は `pnpm view` で確かめた）。

## 版と保守の状況

- WireMock: 安定版は 3.13.2（2025-11-14、npm の `wiremock` も 3.13.2）。その後は 4.0.0 の beta だけで、4.0.0-beta.41 は 2026-10-21。beta.1 のリリースノートは、安定版の 4.0 までに API を壊す変更を入れていくと書いている（[wiremock/wiremock のリリース](https://github.com/wiremock/wiremock/releases)）。repository は 2026-10-23 にも push がある。
- WireMock の Docker イメージ: README の最新は `3.13.2-2` と `latest`。Docker Hub には `4x-beta` と `4.0.0-beta.41-1` もある（[wiremock-docker の README](https://github.com/wiremock/wiremock-docker)、[Docker Hub のタグ](https://hub.docker.com/r/wiremock/wiremock/tags)）。
- Node 向けの WireMock の Testcontainers モジュール（`@wiremock/wiremock-testcontainers-node`）は v0.0.1 の prerelease（2024-05-09）だけで、`testcontainers` ^10 に依存する（[wiremock/wiremock-testcontainers-node](https://github.com/wiremock/wiremock-testcontainers-node)）。testcontainers 本体は 12.2.1（2026-10-13、Node.js 22.22 以上）で、`GenericContainer` だけで足りる（[testcontainers-node のリリース](https://github.com/testcontainers/testcontainers-node/releases)）。
- MSW: 3.0.0（2026-09-28）で ESM だけになり、Node.js 18 と 20 の対応をやめ（最小は 22）、Node.js 24 と 26 の対応を明記した。TypeScript は 5.9 以上（[MSW v3.0.0 のリリース](https://github.com/mswjs/msw/releases/tag/v3.0.0)）。最新は 3.0.3（2026-10-10）で、npm の engines は `>=22.12.0`。
- Prism: 最新は 5.16.0（2026-07-17）で、`@stoplight/prism-cli` の engines は `>=24.18.0`（[stoplightio/prism のリリース](https://github.com/stoplightio/prism/releases)）。依存の更新は 2026-10-22 まで続いている。
- Prism の Docker イメージは `5.15.10`（2026-04-20）止まりで、`5.16.0` のタグはない（[Docker Hub のタグ](https://hub.docker.com/r/stoplight/prism/tags)）。実験: `stoplight/prism:5.15.10` は `NODE_ENV=production` が入っていて、既定のマルチプロセスの起動で `Cannot read properties of undefined (reading 'isPrimary')` で落ちた。`-m false` で起動できた。修正の PR（[#2813](https://github.com/stoplightio/prism/pull/2813)、[#2852](https://github.com/stoplightio/prism/pull/2852)）は 2026-10-24 時点でどちらもマージされていない。
- Hono: リポジトリは `hono` ^4.13.13 と `@hono/node-server` ^2.1.5 をすでに使う（`pnpm-workspace.yaml` の catalog）。自前のフェイクは新しい依存を増やさない。

## テナントの返し分け

- WireMock はヘッダーでリクエストを一致させ、応答のテンプレートで `{{request.headers.X-Tenant-Id}}` やパスの変数を本文に入れられる（[WireMock: Response Templating](https://wiremock.org/docs/response-templating/)）。実験: `X-Tenant-Id: t1` と `t2` で別の上長を返し、t1 の本文にはテンプレートでテナントと社員の ID を入れた。
- MSW と Hono の自前のフェイクは、`request.headers.get()` や `c.req.header()` で読み、コードで返し分ける。実験: MSW でテナントごとに別の上長を返し、ヘッダーがなければ 400 を返した。
- Prism は example を `Prefer: example=<名前>` で選ぶ（[Prism: Mocking](https://github.com/stoplightio/prism/blob/master/docs/guides/01-mocking.md)）。リクエストの値で example を選ぶ方法は文書にない。実験: `X-Tenant-Id: t2` を送っても最初の example（t1 の上長）が返り、`Prefer: example=t2` を足して初めて t2 の上長が返った。テナントで返し分けるには、アプリがテスト用の `Prefer` を送るか、前にプロキシを置く必要がある。

## 標準のやり方とアンチパターン

- 標準: 外部の HTTP のシステムは、クライアントのモジュールを差し替えるのではなく、HTTP の層でフェイクにする。MSW は「リクエスト X が来たら Y を返す」というネットワークの振る舞いとして書き、アプリのコードを変えないことを方針に挙げている（[MSW: Philosophy](https://mswjs.io/docs/philosophy)）。WireMock は、本物から出しにくい障害を注入できることを Web サービスのフェイクを使う主な理由に挙げている（[WireMock: Simulating Faults](https://wiremock.org/docs/simulating-faults/)）。リポジトリの [テスト準備: スタブとダッシュボード](../docs/performance-test/stub-and-dashboard.md) も、性能テストのスタブは独立したプロセスで用意し、遅延を含む応答を返すことを勧める。
- 避けるアンチパターン:
  - `fetch` やクライアントの関数を直接モックし、HTTP の振る舞い（status、ヘッダー、タイムアウト）を通さないこと（[MSW: Philosophy](https://mswjs.io/docs/philosophy) の読み取り。判断）。
  - 受けたリクエストへのアサーションを主にし、アプリの反応を見ないこと（[MSW: Avoid request assertions](https://mswjs.io/docs/best-practices/avoid-request-assertions)）。WireMock の件数の検証も、通知のような一方向の呼び出しに絞る（判断）。
  - 未知のリクエストを黙って通すこと。MSW は `onUnhandledFrame: 'error'`、WireMock は unmatched の取得で見つける（各出典は上の節）。
  - 本番の入口のファイルにモックの起動（`server.listen()`）を入れること。E2E のために API の入口へ MSW を入れると、本番のコードにテストの分岐が残る（判断）。
  - スタブを OpenAPI や型と別に手で書き続け、本物と食い違わせること。Prism の validation proxy や openapi-msw の型で検出する（各出典は上の節）。
  - 版を固定しない `latest` のイメージ。WireMock の `latest` は 4.0 の安定版が出たときに API を壊す変更を連れてくる（判断。beta.1 のリリースノートより）。

## 判断

- 第一候補: WireMock の Docker イメージ `wiremock/wiremock:3.13.2-2` を版で固定し、Vite+ のテストでは testcontainers の `GenericContainer` を `globalSetup` で起動する。ローカルの起動と E2E は同じ mappings の JSON を mount する。Node 向けの WireMock の Testcontainers モジュールは使わない。理由は、タイムアウトと再試行のテストに要る遅延、接続断、状態、受けたリクエストの検証、テナントの返し分けがすべて設定でそろい、Node.js 26 の `fetch` から実験で確かめられたこと。
- 第一候補の弱点: OpenAPI と型との同期を持たないこと、Java のイメージ（Docker）が要ること、安定版が 2025-11 から出ていないこと。同期は、人事システムの OpenAPI を置くなら Prism の validation proxy を前に置いて CI で検査するか、mappings の本文を OpenAPI の schema で検査するテストを足して補う。
- 次点: Hono の自前のフェイク。新しい依存がなく、型をアプリと共有でき、同じプロセスでも別のプロセスでも動く。代わりに、遅延、接続断（Node.js の socket を触る）、状態のリセット、受けたリクエストの記録を自分で書き、保守する。人事システムの API は上長の問い合わせ 1 本と小さいので、書く量は少ない。
- MSW は、web（React）のテストで API をフェイクにするときに強い。人事システムのフェイクを MSW にすると、E2E とローカルの起動に `@msw/serve` が要り、公式が勧めない単独のモックサーバーの使い方になる。
- Prism は主役にしない。遅延、接続断、状態、テナントの返し分けがなく、Docker イメージが npm の版に遅れて既定の設定で落ちる。OpenAPI の契約の検査の補助には使える。

## 未確認のこと

- testcontainers 12 で WireMock のコンテナを `globalSetup` から実際に起動した結果（実験は `docker run` で行った）。CI（GitHub Actions）の Docker での起動時間。
- WireMock 4.0 の安定版の時期と、壊れる API の範囲（mappings の JSON の形が変わるか）。
- `@msw/source` の OpenAPI 3.1 への対応。
- Prism の validation proxy を WireMock の前に置いたときの動き。
- 人事システムの本物の API が OpenAPI を公開するか。サンプル機能では本物の SaaS につながないので、OpenAPI はリポジトリで書くことになる（判断）。

## 出典

- WireMock: [Simulating Faults](https://wiremock.org/docs/simulating-faults/)、[Stateful Behaviour](https://wiremock.org/docs/stateful-behaviour/)、[Verifying](https://wiremock.org/docs/verifying/)、[Response Templating](https://wiremock.org/docs/response-templating/)、[リリース](https://github.com/wiremock/wiremock/releases)、[wiremock-docker](https://github.com/wiremock/wiremock-docker)、[Docker Hub のタグ](https://hub.docker.com/r/wiremock/wiremock/tags)、[wiremock-testcontainers-node](https://github.com/wiremock/wiremock-testcontainers-node)
- Testcontainers: [Containers](https://node.testcontainers.org/features/containers/)、[testcontainers-node のリリース](https://github.com/testcontainers/testcontainers-node/releases)
- MSW: [Philosophy](https://mswjs.io/docs/philosophy)、[Node.js integration](https://mswjs.io/docs/integrations/node)、[delay](https://mswjs.io/docs/api/delay)、[HttpResponse](https://mswjs.io/docs/api/http-response)、[Avoid request assertions](https://mswjs.io/docs/best-practices/avoid-request-assertions)、[TypeScript](https://mswjs.io/docs/best-practices/typescript)、[server.use()](https://mswjs.io/docs/api/setup-server/use)、[Serve](https://mswjs.io/ecosystem/serve)、[Source](https://mswjs.io/ecosystem/source)、[v3.0.0 のリリース](https://github.com/mswjs/msw/releases/tag/v3.0.0)、[openapi-msw](https://github.com/christoph-fricke/openapi-msw)
- Prism: [README](https://github.com/stoplightio/prism)、[Concepts](https://github.com/stoplightio/prism/blob/master/docs/getting-started/02-concepts.md)、[CLI](https://github.com/stoplightio/prism/blob/master/docs/getting-started/03-cli.md)、[Mocking](https://github.com/stoplightio/prism/blob/master/docs/guides/01-mocking.md)、[Errors](https://github.com/stoplightio/prism/blob/master/docs/guides/06-errors.md)、[#1140](https://github.com/stoplightio/prism/issues/1140)、[リリース](https://github.com/stoplightio/prism/releases)、[Docker Hub のタグ](https://hub.docker.com/r/stoplight/prism/tags)
- Hono: [Testing Helper](https://hono.dev/docs/helpers/testing)、[Testing](https://hono.dev/docs/guides/testing)、[honojs/node-server](https://github.com/honojs/node-server)
- Vitest: [globalSetup](https://vitest.dev/config/globalsetup)。Playwright: [Web server](https://playwright.dev/docs/test-webserver)
- npm の版と engines は 2026-10-24 に `pnpm view` で確かめた（msw、`@msw/source`、`@msw/serve`、`@stoplight/prism-cli`、testcontainers、wiremock、openapi-msw、openapi-typescript、`@hono/zod-openapi`、hono）。
