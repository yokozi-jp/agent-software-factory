---
type: ADR
title: "ADR 0039: ゲートの E2E は Playwright の決定的なコードで書き、AI は E2E を書く側と開発中の確認に使う"
description: CI のゲートになる E2E を Playwright の決定的なコード（.spec.ts）にし、実行時にモデルが判定するテストをゲートにしない決定。e2e（tester.army）は開発中の確認に限り、CI に置かない。PR の必須チェックは少数の重要な導線と Chromium だけにし、retry は 1 回までで flaky を見える状態にする。起動は testcontainers を globalSetup から使い、build 済みの API と web を webServer で起動する。1 つのスイートを @smoke のタグで分け、検証環境では @smoke だけを PLAYWRIGHT_TEST_BASE_URL で流す。E2E の道具や CI での範囲を変えるとき、e2e や AI で操作するテストを CI に入れたくなったとき、E2E の起動に compose を足したくなったとき、@smoke の範囲を変えるときに読む。
tags: [adr, e2e, playwright, testing, ci, ai]
---

# ADR 0039: ゲートの E2E は Playwright の決定的なコードで書き、AI は E2E を書く側と開発中の確認に使う

E2E の道具として、Playwright だけで書くか、e2e（tester.army）のように AI で操作する framework を併用するかを比べました。CI のゲートになる E2E は Playwright の決定的なコードにします。AI は E2E を書く側と、書く前の確認に使い、CI では決定的なコードだけを流します。比べた結果は [#222](https://github.com/yokozi-jp/agent-software-factory/issues/222)、[#304](https://github.com/yokozi-jp/agent-software-factory/issues/304)、[#305](https://github.com/yokozi-jp/agent-software-factory/issues/305) に、決めた経緯は [E2E テストの道具を決める](https://github.com/yokozi-jp/agent-software-factory/issues/223) の解決コメントにあります。検証環境の E2E の流れは [検証環境の流れ](../tooling/verification-environment.md) にあります。

## 決定

- **ゲートの E2E**: CI のゲートになる E2E は、Playwright の決定的なコード（`.spec.ts`）で書きます。実行時にモデルが判定するテストはゲートにしません。[web のテストの文書](../web-frontend/testing.md)の「E2E は Playwright」は変えません。
- **e2e（tester.army）**: 開発中の確認に限ります。E2E を書く前に、実アプリを動かして確かめる用途です。CI のゲートにしません。e2e の API で書いたテスト（`*.e2e.ts`）は CI に置きません。確認の後に残すテストは、Playwright の `.spec.ts` に書きます。正式に採る前に、Kiro で `e2e mcp` と skill が動くかを小さく確かめます（判断。e2e の文書に Kiro の記載がなく、動かして確かめていません。[#310](https://github.com/yokozi-jp/agent-software-factory/issues/310)）。次のどれかが満たされたら、使い方を見直します。e2e が 1.0 に届く。Playwright の `page` を公開する。axe-core を入れられる。
- **AI の使い方**: AI は E2E を「書く」側に使います。CI で流すのは、書かれた決定的なコードだけです。
- **PR の必須チェック**: 日々の CI の E2E は、PR の必須チェックにします。範囲は少数の重要な導線（ログイン、主要な書き込み 1〜2 本）と Chromium だけです。広い網羅は merge 後と定期の実行に回します。AWS の実物には依存させません。retry は 1 回までにし、`flaky` の分類を見ます。隔離は期限か数の上限を付けます（判断。範囲の分け方は Playwright の文書に指定がありません）。
- **起動方式**: 結合テストと同じ testcontainers（`postgres:17`、Keycloak、同じ realm、同じ migrate と bootstrap）を Playwright の `globalSetup` から使い、build 済みの API と web を `webServer` で起動します。compose は足しません（判断。Playwright の文書にあるのは `webServer` と公式の Docker イメージだけです）。結合テストの起動は `apps/api/test/global-setup.ts` にあります。
- **ログイン**: ログインのテストだけが Keycloak の画面を通します。業務の導線は、Better Auth の `testUtils` で作ったセッションの Cookie から始めます（[ADR 0022](0022-better-auth-cookie-bff.md)）。
- **検証環境との分担**: 1 つの Playwright のスイートをタグで分けます。毎 PR の CI で全部を流し、検証環境（[#88](https://github.com/yokozi-jp/agent-software-factory/issues/88)）では `@smoke` だけを流します。流す先は `PLAYWRIGHT_TEST_BASE_URL` で切り替えます。AWS に依存する導線は `@smoke` だけにします。

## Considered Options

- **e2e をゲートの E2E にする**: `agent.assert`、`agent.waitFor`、`agent.extract` は毎回モデルを呼びます。記録した `agent.act` の再生が外れると、既定ではモデルが引き継ぎ、誰かが記録し直すまで CI のたびにモデルの費用がかかります。`--strict-cache` なら `REPLAY_STALE` で落ちてモデルは呼びませんが、新しい指示や変えた指示の step は strict でも live で動きます（[Caching](https://e2e.tester.army/docs/cache)）。`browser` fixture の members に Playwright の `page` そのものはなく（[Web engine reference](https://e2e.tester.army/docs/reference/web)）、axe-core を入れられるかは確かめられませんでした（[#222](https://github.com/yokozi-jp/agent-software-factory/issues/222)）。0.x で、リポジトリの作成は 2026-07-22 です。ゲートは決定的であるべきなので、採りません。
- **Playwright だけにして、e2e を使わない**: Playwright の test agents（planner、generator、healer）は、出力が通常の `.spec.ts` で、実行時にモデルは要りません（[Agents](https://playwright.dev/docs/test-agents)）。ゲートの E2E の書式をそろえるには足ります。一方、確認の手順を skill に残すことと、複数の explore を並列に流す bug bash は、調べた範囲では e2e にだけありました（[#304](https://github.com/yokozi-jp/agent-software-factory/issues/304)）。そのため、開発中の確認に限って e2e を採ります。
- **PR では流さず、検証環境だけで流す**: 検証環境は AWS の上に作って消す環境で、常には置きません（[ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md)）。Playwright の文書は、テストを各 commit と PR で流すよう勧めています（[Best Practices](https://playwright.dev/docs/best-practices)）。日々の確認と AWS の配線の確認は役割が違うので、分けます。
- **E2E の起動に docker compose を使う**: Playwright の文書にあるのは `webServer` と公式の Docker イメージだけです（[webServer](https://playwright.dev/docs/test-webserver)、[Continuous Integration](https://playwright.dev/docs/ci)）。結合テストがすでに testcontainers で PostgreSQL と Keycloak を起動するので、同じ起動を再利用して、起動の定義を 1 つにします。
- **`globalSetup` ではなく project dependencies で起動する**: Playwright の文書は、HTML レポートと trace と fixture が使える project dependencies を勧めています（[Global setup and teardown](https://playwright.dev/docs/test-global-setup-teardown)）。コンテナの起動に trace や fixture は要らず、`apps/api/test/global-setup.ts` と同じ形にそろえられるので、`globalSetup` にします（判断）。
- **全ブラウザ、全導線を毎 PR で流す**: Playwright の文書は、CI では必要なブラウザだけを入れるよう勧めています（[Best Practices](https://playwright.dev/docs/best-practices)）。失敗が分かるまでの時間が長くなるので、PR の必須は絞り、広い網羅は merge 後と定期に回します（判断）。

## Consequences

- PR の CI の E2E は、Docker が使える runner を要し、結合テストと同じコンテナを起動する時間がかかります。実行時間は測っていません。Playwright の文書は、CI では `globalTimeout` を必ず設定するよう求めています（[Continuous Integration](https://playwright.dev/docs/ci)）。
- retry は `retries: 1` までにし、`flaky` を報告で見ます（[Retries](https://playwright.dev/docs/test-retries)）。`failOnFlakyTests` で落とすかどうかは、`flaky` の件数を見てから決めます（[TestConfig](https://playwright.dev/docs/api/class-testconfig)）。隔離したテストの期限か上限の値は、まだ決めていません。
- Playwright は `webServer` を `globalSetup` より先に起動します（1.64.1 の `createGlobalSetupTasks` が、plugin の setup を `globalSetup` の前に並べている。[tasks.ts](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright/src/runner/tasks.ts)）。そのため、`webServer` の command は、`globalSetup` が起動したコンテナの接続先を環境変数で受け取れません。API は起動時に DB の接続先を要ります（[ADR 0032](0032-env-read-at-entry-and-passed-as-argument.md)）。この順序は文書に書かれていないので、実施（[#311](https://github.com/yokozi-jp/agent-software-factory/issues/311)）で、次の案から選びます（どれも判断）。コンテナのホスト側の port を固定する。`webServer` の command が、`globalSetup` の書く接続先のファイルを待ってから API を起動する。`webServer` を使わず、`globalSetup` から API と web を起動して ready を自分で待つ。
- 検証環境の `@smoke` は、ログインを Cognito の managed login で通します（[検証環境の流れ](../tooling/verification-environment.md)）。CI は Keycloak の画面なので、`@smoke` のログインの手順は環境ごとに切り替えます。タグの付け方と切り替えは [#312](https://github.com/yokozi-jp/agent-software-factory/issues/312) で決めます。
- e2e の CLI は、既定で利用状況を送ります。`E2E_TELEMETRY_DISABLED=1` か `DO_NOT_TRACK=1` で止まります（[Telemetry](https://e2e.tester.army/docs/telemetry)）。開発中に使うときは、環境変数で止めます。
- 開発中の確認で e2e を使うと、確認の後に Playwright の `.spec.ts` へ書き写す手間が残ります。

## 出典

- Playwright の `webServer`、`reuseExistingServer: !process.env.CI`、`baseURL`: [Web server](https://playwright.dev/docs/test-webserver)（2026-10-28 に読んだ）
- `globalSetup` と project dependencies の比較: [Global setup and teardown](https://playwright.dev/docs/test-global-setup-teardown)（同）
- `PLAYWRIGHT_TEST_BASE_URL` で流す先を切り替える例、`workers`、`globalTimeout`、公式の Docker イメージ: [Continuous Integration](https://playwright.dev/docs/ci)（同）。`PLAYWRIGHT_TEST_BASE_URL` を `baseURL` の既定にしている箇所: [index.ts](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright/src/index.ts)
- タグと `--grep`: [Annotations](https://playwright.dev/docs/test-annotations)（同）
- retry と `flaky` の分類: [Retries](https://playwright.dev/docs/test-retries)（同）。`failOnFlakyTests`、`globalTimeout`: [TestConfig](https://playwright.dev/docs/api/class-testconfig)（同）
- 各 commit と PR で流すこと、CI では必要なブラウザだけを入れること: [Best Practices](https://playwright.dev/docs/best-practices)（同）
- Playwright の test agents: [Agents](https://playwright.dev/docs/test-agents)（同）
- e2e の記録と再生、モデルを呼ぶ step、`--strict-cache`: [Caching](https://e2e.tester.army/docs/cache)（同）。`browser` fixture: [Web engine reference](https://e2e.tester.army/docs/reference/web)（同）。テレメトリ: [Telemetry](https://e2e.tester.army/docs/telemetry)（同）
- e2e の成熟度、`create-verification-skill`、`e2e mcp`、bug bash、Kiro の記載がないこと: このリポジトリの調査（[#222](https://github.com/yokozi-jp/agent-software-factory/issues/222)、[#304](https://github.com/yokozi-jp/agent-software-factory/issues/304)）。e2e 自体は実行していません（モデルの API key がない）。
- `webServer` が `globalSetup` より先に起動すること: Playwright 1.64.1 のソース（2026-10-28 に読んだ。[tasks.ts](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright/src/runner/tasks.ts)）
