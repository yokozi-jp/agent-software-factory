---
type: ADR
title: "ADR 0049: ロガーは pino を自前の Logger インターフェースの後ろに置き、文脈は毎行ロガーが付け、マスクは三層で守る"
description: API のロギングの決定。アプリは packages/logging の Logger (debug、info、warn、error) にだけ依存し、pino は Node 専用の入口が同期書き込みの出力先と共に作る。毎行に付けるキー、アクセスログの middleware の順序、5xx と 401、403、400 の記録、warn 以上のメッセージコード (TypeScript の定数)、三層のマスク、console と pino の import の禁止を決める。ロガーやログのキーを足す、変えるとき、console を使いたくなったとき、pino や OpenTelemetry のログ SDK を import したくなったとき、warn 以上のログを足すとき、ログに値を載せるときに読む。
tags: [adr, logging, pino, observability, security, lint]
---

# ADR 0049: ロガーは pino を自前の Logger インターフェースの後ろに置き、文脈は毎行ロガーが付け、マスクは三層で守る

`apps/api` は 5xx を `console.error` で暫定に出すだけで、アクセスログも、リクエストの文脈も、マスクも、メッセージコードもありませんでした。ロガーの選定は [Issue #228](https://github.com/yokozi-jp/agent-software-factory/issues/228) で比べ、[Issue #229](https://github.com/yokozi-jp/agent-software-factory/issues/229) で決め、[Issue #327](https://github.com/yokozi-jp/agent-software-factory/issues/327) で実装しました。

## 決定

- **ロガーは pino。アプリは `Logger` にだけ依存する**: `packages/logging` (module ではない package。`moduleOrder` に入れず、どの package にも依存しない) が `Logger` (`debug`、`info`、`warn`、`error`) と `LogFields` を `.` の入口に、pino の実装を `./node` (Node 専用の入口) に置き、テスト用のメモリ上の出力先 (`memoryDestination`) は `./testing` に分けて本番の入口に混ぜません。pino は `pino.destination({ sync: true })` と共に作り、worker transport は使いません: transport は別スレッドで起動が非同期のため、`process.exit()` の前だと行を失う、と #229 で確かめたためです (5000 行の実測で `sync: true` は全部届いた)。`Logger` で包む点は出典のない判断です。pino を替えるとき、変更を 1 か所に閉じるためです。Powertools Logger は標準キーが [ログのキー名](../logging/keys.md) と合わないので採りません。
- **毎行に付ける項目**: `timestamp` (UTC、ミリ秒 3 桁)、`severity.text`、`level`、`message`、`service.name`、`service.version`、`deployment.environment`、`trace_id`、`span_id`、`trace_flags`、`http.request.id`、`tenant_id`、`user.id` (ログイン済みのとき)。`Logger` の実装が、リクエストの文脈 (API は `hono/context-storage`。ワーカーとバッチは入口の `AsyncLocalStorage.run`) と `@opentelemetry/api` の `trace.getActiveSpan()` から書くときに読みます。呼び出し側は文脈を渡しません。`level` は Lambda の絞り込み用の併記で、`severity.text` と同じ大文字の値です。**Lambda に置く前に費用 (1 行のバイト数 × 行数) を実測し、`level` の併記を続けるか見直します**。大文字・小文字の扱いと取り込みは AWS の上で確かめます (デプロイの実施の Issue)。
- **アクセスログは自前の middleware**: 順序は `contextStorage()` → `@hono/otel` → `requestContext()` (`http.request.id` を `c.set`) → `accessLog()`。`@hono/otel` の前に置くと `trace_id` が付きません (#228)。要求時 (`request received`) と応答時 (`request completed`) を両方 `info` で出し、`/health` は出さず、`OPTIONS` は出します。クエリ文字列は出さず (`url.path`)、`client.address` は出しません ([Issue #321](https://github.com/yokozi-jp/agent-software-factory/issues/321) で決めるまで)。`X-Request-Id` は `[A-Za-z0-9._-]{1,128}` に合うときだけ使い、合わなければ採番します (ログの汚染を避けるため。判断)。
- **レベル**: `LOG_LEVEL` (`debug`、`info`、`warn`、`error`) を入口が読んで引数で渡します。ローカルと開発は `debug`、検証と本番は `info`。実行中は変えません。`Logger` に `fatal` は足さず、起動の失敗は入口が `startOrFail` で `fatal` (`API-002`) を出して `process.exitCode` を非ゼロにします (`process.exit()` は呼ばない)。ロガーは環境変数全体の検査より前に要るので、`loadLoggerSettings` が `LOG_LEVEL` などだけを、正しくなければ既定にして先に読みます。`warn` 以上は一律に通知の対象で、通知フラグは入れません ([ログレベルと通知](../logging/levels-and-notification.md)、[ADR 0032](0032-env-read-at-entry-and-passed-as-argument.md))。
- **エラーのログは `app.onError` の 1 か所**: 応答の変換とログを `problemErrorHandler(logUnexpectedError(logger))` で行います ([ADR 0035](0035-problem-details-for-api-errors.md))。5xx は `error` で、`exception.type`、`exception.message`、`exception.stacktrace`、`event.kind`、`event.category`、`event.outcome`、`event.code` (`API-001`) を付けます。401、403、400 の検証失敗は、応答のあとに `accessLog` が理由 (Problem の `type` を `error.type` に) つきの `request rejected` を `info` で 1 行足します (`event.category` は 401 が `authentication`、403 が `iam`、400 が `web`)。`warn` ではなく `info` にするのは alarm fog を避ける判断です。それ以外の 4xx は出しません。応答の本文は `Response.clone()` で読みます。本文が `problem+json` でなく理由が読めないときも、401 と 403 は `error.type` なしで残し、400 は検証失敗と分からないので残しません。`User-Agent` は 512 文字で切ります。
- **メッセージコード**: `warn` 以上に `event.code` を付けます。定義は `packages/logging/src/index.ts` の `messageCodes` (TypeScript の定数) で、`level`、`message`、`cause` (発生原因)、`action` (運用者の対応) を持ちます。`warn` と `error` は、その `level` のキーだけを型で受け取ります (別のレベルのコードや未定義のコードは型検査で落ちる)。形は `<領域>-<3桁>` で、想定外の例外は領域ごとに固定のコード (`API-001`) です。
- **マスクは三層**: (1) 発生源で載せない: `LogFields` のキーだけを渡せ、秘匿情報になるキーはない。例外は `exceptionFields()` で型、メッセージ、スタックトレースだけを出し、pg のエラーの `detail`、`where`、`parameters` は読みません。(2) pino の `redact`: 最上位と 1 段下 (`*`) の秘匿キー (`password`、`token`、`authorization`、`cookie`、`set-cookie`、`detail`、`where`、`parameters` など) を `[REDACTED]` にします。(3) 保存先 (CloudWatch Logs のデータ保護)。2 層目は、`message` の文字列に混ぜた値、綴りの違うキー、2 段より深い入れ子を守れません。このことを `node.test.ts` に「守れないもの」として書き、1 層目と 3 層目で受け止めます。`user.id` と `tenant_id` は UUID で、秘匿しません。
- **検査**: `console` を `vite.config.ts` の `runtimeGlobals` に足し、`no-restricted-globals` (裸の名前、別名、分割代入) と `no-restricted-properties` (`globalThis.console`) で止めます。`no-console` は別名と `globalThis.console` を止めない (#228) ので使いません。fixture (`apps/api/src/__fixtures__/console.ts`、`packages/module-fixtures/src/__fixtures__/console.ts`。#327 では `runtime-apis.ts` にあり、[ADR 0050](0050-lint-restrictions-table-in-json.md) で分けた) で、別名と `globalThis.console` が止まることを確かめたので、`tools/lint-plugins` の plugin は足しません。`pino` の import は `no-restricted-imports` で止め、許すのは `packages/logging/src/node.ts` と、アプリの入口、テストだけです。`@opentelemetry/*` は [ADR 0048](0048-opentelemetry-traces-only-with-explicit-instrumentation.md) のとおり `@opentelemetry/api` だけが全体で許され、SDK は入口に限ります (ロガーが読むのは `api` だけ)。

## ドキュメントの規約からの変更

[ログ設計ガイドライン](../logging/about.md) からの変更は `docs/logging/about.md` の「原文からの変更点」に書きました。

- ログレベルのキーは `severity.text` を正とし、`level` を併記する。
- `request.id` を `http.request.id`、`user_id` を `user.id` にした。標準のキー (ECS の `http.request.id`、OTel の `user.id`) に揃えるため。
- `tenant_id`、`trace_flags`、`event.code`、`error.type` を足した。
- メッセージコードの定義書を、Markdown の表ではなく TypeScript の定数にした (`warn`/`error` が定義のキーだけを受け取る型にするため)。

## Considered Options

- **Powertools Logger**: Lambda での取り込みは容易だが、標準のキーが `keys.md` (OTel と ECS) と合わず、`level` と `message` 以外の名前を変えるには包む層が要る。包むなら pino に直接つなぐ方が単純なので採りません。
- **worker transport (pino-pretty、pino/file など)**: 起動が非同期で `process.exit()` の前に行を失うおそれがあり、今は stdout に書くだけで別スレッドに任せる処理がないため採りません。
- **ログを OTLP で送る**: [ADR 0048](0048-opentelemetry-traces-only-with-explicit-instrumentation.md) で採りません。
- **アプリが pino を直接使う**: 型 (`LogFields`、`event.code`) と文脈の付与を強制できず、替えるときの変更が広がります。
- **`no-console` ルール**: 別名と `globalThis.console` を止めないので、`no-restricted-globals` と `no-restricted-properties` を使います。
- **メッセージコードを Markdown の表で管理する**: 表とコードが食い違っても検査できません。TypeScript の定数なら、未定義のコードは型検査で、`action` の空は `index.test.ts` で止まります。

## Consequences

- `packages/logging` を足したため、`moduleOrder` に入れない package として `modules.ts` に登録し、`apps/api` の入口とテストだけが `@agent-software-factory/logging/node` を import します。
- warn 以上のログを足すときは、`messageCodes` に定義 (`message`、`cause`、`action`) を足します。`action` が空だとテストが落ちます。
- `apps/worker` は `console.error` の 1 行 (`apps/worker/src/log.ts`) のまま、`oxlint-disable-next-line` で止めています。ワーカーとバッチの入口に `AsyncLocalStorage.run` と `Logger` を入れるのは別の作業です。
- `tenant_id` を `c.set("tenantId", …)` する middleware は、テナントを決める実装が揃ったときに足します。今は `requestLogContext()` が読む口だけがあり、`apps/api` のどの経路もまだ値を入れません。
- AWS の上の確認 (`level` の大文字・小文字、Web Functions での取り込み、CloudWatch Logs のデータ保護、`level` の併記の費用) は、デプロイの実施の Issue に残ります。
- `pg` のエラーの `message` に値が入らないことは、決定のときの知識に基づく前提で、実測していません。入る型のエラーが見つかったら、`exceptionFields()` で `exception.message` を落とします。

## 出典

- [Issue #228](https://github.com/yokozi-jp/agent-software-factory/issues/228): ロガーの比較
- [Issue #229](https://github.com/yokozi-jp/agent-software-factory/issues/229) の解決コメント: 決定
- [Issue #327](https://github.com/yokozi-jp/agent-software-factory/issues/327): 実装
- [pino の API](https://getpino.io/#/docs/api)、[redaction](https://getpino.io/#/docs/redaction)、[transports](https://getpino.io/#/docs/transports)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- OpenTelemetry: [Non-OTLP Log Formats の trace context](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)、[例外のログ](https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/)
- ECS: [event](https://www.elastic.co/docs/reference/ecs/ecs-event)、[http](https://www.elastic.co/docs/reference/ecs/ecs-http)
