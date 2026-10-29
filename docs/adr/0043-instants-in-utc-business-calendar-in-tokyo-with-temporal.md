---
type: ADR
title: "ADR 0043: 瞬間は UTC で持ち、業務の暦と表示は Asia/Tokyo で解釈し、日時は Temporal で扱い、現在時刻は入口が Clock から 1 回読む"
description: システム全体の日時とタイムゾーンの決定。瞬間は timestamptz と Z の RFC 3339（ミリ秒 3 桁）で保存、受け渡し、記録し、業務の暦（締めの境界、今日の日付、Scheduler）と画面とメールの表示は IANA の名前 Asia/Tokyo（システムで 1 つ）で解釈する。利用日などの暦日は変換しない date と YYYY-MM-DD。型は temporal-polyfill の global の Temporal で、domain は global の型を import なしで受ける。現在時刻は入口が Effect の Clock から 1 回読んで now で渡し、Date の値と Temporal.Now は全体で止める。pg は date と timestamptz を Temporal で読み、書きは文字列にする。本番の TZ と DB のセッションは UTC のまま頼らず、テストは America/New_York で流す。比べた案は、テナントごとのタイムゾーン、環境変数、date-fns、Intl と branded の文字列、Effect の DateTime、サーバーの既定を東京にする案、application で Clock を読む案。日時の型や書式を決めるとき、Date や Temporal.Now を使いたくなったとき、タイムゾーンを足したくなったとき、pg の日時の読み書きを変えるとき、TZ に頼るテストを書くときに読む。
tags: [adr, datetime, timezone, temporal, postgresql, api, logging, testing]
---

# ADR 0043: 瞬間は UTC で持ち、業務の暦と表示は Asia/Tokyo で解釈し、日時は Temporal で扱い、現在時刻は入口が Clock から 1 回読む

締めの境界、API の書式、ログ、CSV、画面の表示のタイムゾーンの記述が、複数の規約に散らばり、システム全体の方針がありませんでした（[締めのバッチの業務日付、照合、再実行、途中からの再開、オンラインとの排他を決める](https://github.com/yokozi-jp/agent-software-factory/issues/354) で分かった）。日時の型と計算の道具も決めていませんでした。この ADR は、その決定です。経緯は [システム全体の日時とタイムゾーンの扱いを決める](https://github.com/yokozi-jp/agent-software-factory/issues/365) の解決コメントに、入力の調査は [Node.js 24 とブラウザで日時とタイムゾーンを扱う方法を比べる](https://github.com/yokozi-jp/agent-software-factory/issues/364) にあります。取り込んだ [PostgreSQL設計ガイドライン](../db/about.md)、[Web API設計ガイドライン](../web-api/about.md)、[ログ設計ガイドライン](../logging/about.md) の規約と違う点は、理由と一緒に残します。

## ルール

- **UTC と東京を役割で分ける**:
  - 瞬間（いつ起きたか）は UTC で持ち、渡し、記録します。DB、API、ログ、CSV のシステム項目がこれに当たります。
  - 業務の暦で区切る、見せるものは、業務のタイムゾーンで解釈します。締めの境界、今日の業務の日付、EventBridge Scheduler の起動、画面とメールの表示がこれに当たります。
- **業務のタイムゾーン**: システムで 1 つの `Asia/Tokyo` です。オフセットではなく IANA の名前で持ち、定数 `BUSINESS_TIME_ZONE` を `packages/shared` に置きます。API、バッチ、CDK（Scheduler の `scheduleExpressionTimezone`）がこの定数を読みます。計算する関数は、タイムゾーンを引数で受けます。テナントごとには持ちません。用語は [GLOSSARY.md](../../GLOSSARY.md) の「業務のタイムゾーン」です。
- **保存**: 瞬間は `timestamptz` だけにして、`timestamp`（タイムゾーン無し）は使いません。利用日のような暦日は `date` で、領収書に書かれた日付として扱い、タイムゾーンで直しません。操作した利用者のオフセットやタイムゾーンの列は持ちません。
- **API の書式**: 瞬間は `Z` の RFC 3339 でミリ秒の 3 桁（`2026-04-01T02:00:00.000Z`）、暦日は `full-date`（`2026-03-31`）です。入力も同じ形だけを受け、オフセット付きは 400 にします。RFC 9557 の名前付きの日時は今は使いません。
- **ログと CSV の書式**: ログの `timestamp` は `Z` でミリ秒の 3 桁に固定します。JST（`+09:00`）は使いません。CSV のシステム項目の瞬間（`created_at`、`updated_at`）も同じ形で、利用日は `YYYY-MM-DD`、締め月は `YYYY-MM` です。
- **表示**: web と通知メールは、業務のタイムゾーンで表示します。`Intl.DateTimeFormat` や `toLocaleString` に `timeZone` を必ず渡し、書式は i18next の言語に合わせます。ブラウザや実行環境の既定のタイムゾーンは使いません。
- **プロセスと DB の既定**: 本番の Lambda と ECS の `TZ`、DB のセッションの `TimeZone` は既定の UTC のまま触らず、コードはこれらに頼りません。SQL の中で `::date`、`date_trunc`、`AT TIME ZONE` を使って日時から暦日や境界を作らず、境界は TypeScript の純粋な関数が求めて引数で渡します（[ADR 0042](0042-closing-batch-catches-up-daily-without-locks.md)）。
- **テスト**: Vitest の node の project（`apps/api`、`packages/shared`、`packages/db`）は `TZ=America/New_York` で流します。業務のタイムゾーン（東京）とも本番（UTC）とも違う、夏時間のあるタイムゾーンなので、プロセスの `TZ` に頼る誤りが、どちらを前提にしていても出ます。設定が効いていることは、各 project のテストが確かめます。web の browser mode は、Playwright の `contextOptions.timezoneId` を `America/New_York` にして流します。効いていることは `apps/web/src/lib/date-time.test.ts` が確かめます（[web の Temporal と、業務のタイムゾーンでの表示を置く](https://github.com/yokozi-jp/agent-software-factory/issues/374)）。
- **型と道具**: 日時は `Temporal`（temporal-polyfill の global）で扱います。API、バッチ、ワーカーの入口と Vitest の setup が `temporal-polyfill/global` を import し、型は tsconfig の `lib` の `esnext.temporal` から得ます。web は Safari と iOS が組み込みの `Temporal` を持たないので、polyfill を残します。
- **`domain` の型**: `Temporal.Instant`（瞬間）と `Temporal.PlainDate`（暦日）を、import せずに global の型として受けます。自前の branded の `Instant` は作りません（[ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md) の「`domain` は何も import しない」を保てる）。
- **現在時刻**: 入口（route の handler、ワーカーの 1 件、バッチの 1 回の実行）が、`packages/shared` の `currentInstant`（Effect の `Clock` を読んで `Temporal.Instant` にする）で 1 回読み、`now` の引数で渡します。`application` と `domain` は `now` を引数で受け、`Clock` を読みません（`domain` は `effect` を import できないので、`Clock` の import を止める規則は `application` にだけ置きます）。`Date` の値（`new Date()`、`Date.now()`）と `Temporal.Now` は、`apps/api/src` と `packages/*/src` の全体で止めます。`Clock` の import は `application` で止めます。ライブラリが `Date` を求める箇所は、理由を書いた disable comment で個別に外します。`apps/web` の `Date` と `Temporal.Now` の扱いは、[web の日時の残り](https://github.com/yokozi-jp/agent-software-factory/issues/413)で決めます。
- **pg の読み書き**: `packages/db` が作るアプリの接続に parser を登録し、`timestamptz` を `Temporal.Instant`、`date` を `Temporal.PlainDate` で読みます。`timestamp` は使わないので、読んだら例外にします。書きは `Temporal` の値を渡さず、`toString()` の文字列で渡します。kysely-codegen の型は、読みを `Temporal`、書きを `string` にします。
- **API の境界**: 入力は `z.iso.datetime({ precision: 3 })` と `z.iso.date()` を `.transform` で `Temporal` にします（`packages/shared` の `apiInstant`、`apiDate`）。出力は `toApiInstant`（`toString({ fractionalSecondDigits: 3 })`）と `toApiDate` で文字列にしてから返します。`JSON.stringify` の既定に任せません。
- **Node.js 26**: 組み込みの `Temporal` が既定で有効になります。上げるときは、API とバッチの入口から polyfill の import を消します。

## 標準との違い

- **利用者のタイムゾーンを持たない**: [PostgreSQL の海外対応](../db/postgresql-i18n.md) は、操作した利用者のタイムゾーンを別の列で持ち、表示側でローカル時間に変換する形を示しています。業務のタイムゾーンが 1 つで、表示もそれで行うので、持つ必要がありません（判断）。持つなら、オフセット（`INTERVAL`）ではなく IANA の名前にします。オフセットだけでは、その地域の夏時間の規則を復元できません。
- **ログを UTC に絞る**: [ログ設計ガイドライン](../logging/web-api.md) は UTC と JST のどちらでもよいとしています。環境によって `Z` と `+09:00` が混ざると、並べて読むときに比べ間違えるので、UTC に絞ります（判断）。OpenTelemetry のログのデータモデルの `Timestamp` も、UNIX エポックからの値でタイムゾーンを持ちません（[Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)）。
- **暦日を瞬間で返さない**: [レスポンスボディ](../web-api/response-body.md) の例は、暦日の項目を `2023-09-30T00:00:00Z` で返していました。UTC より西のタイムゾーンで前日に見えるので、`full-date` で返します。
- **CSV を JST にしない**: 経理の人の読みやすさより、ログや DB との突き合わせのしやすさを取ります（判断）。会計システムが JST を求めたら、そのときに合わせます。
- **避けるアンチパターン**:
  - UTC の値を `timestamp` に入れること（PostgreSQL の wiki の [Don't Do This](https://wiki.postgresql.org/wiki/Don't_Do_This)）。
  - 固定のオフセット（`+09:00`）だけでタイムゾーンを持つこと。
  - サーバーや DB の既定のタイムゾーンを東京にして、コードがそれに頼ること。Aurora のタイムゾーンはクラスターのパラメータグループで変わり、同じグループのほかのクラスターも変わります。スナップショットから戻すと UTC に戻ります（[Local time zone for Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.RegionsAndAvailabilityZones.html)）。Lambda の `TZ` は `:UTC` です（[Lambda の環境変数](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)）。
  - 業務の境界を UTC か、プロセスの既定のタイムゾーンで計算すること。UTC の月初にすると、東京の 4 月 1 日 00:00〜09:00 に経理が確認した申請が 3 月分に入ります。
  - 表示をブラウザの既定のタイムゾーンに任せること。
  - 1 つの要求の中で現在時刻を何度も読み、境界の前後で値が食い違うこと。

## Considered Options

- **テナントごとの業務のタイムゾーン**: 用語集の金額は日本円で、テナントは日本の会社です。計算する関数がタイムゾーンを引数で受けるので、要るときは出どころを列に替えるだけで済みます。Scheduler は 1 つのタイムゾーンでしか起動しません。
- **業務のタイムゾーンを環境変数で渡す**: CDK、API、バッチの 3 か所で値をそろえる必要があり、ずれる危険の方が大きいです。
- **date-fns と `@date-fns/tz`**: gzip で 7.3 kB と小さいです。ただし値がすべて `Date` で、暦日と瞬間を型で分けられません。`parseISO` は RFC 9557 を、例外を出さずに 4 時間ずれた時刻で読みました。関数を import するので、`domain` では計算できません。
- **`Intl` と branded の文字列**: 依存は増えませんが、月初の瞬間を求める補正（約 20 行）を自作し、そのテストを持つことになります。
- **Effect の `DateTime`**: `application` と `infrastructure` でしか使えず（ADR 0026、[ADR 0028](0028-effect-in-application-and-infrastructure.md)）、web には入れられません。
- **`@js-temporal/polyfill`**: temporal-polyfill の約 2.3 倍の大きさで、2025-03 から release が無く、global にも入りません。
- **サーバーや DB の既定を東京にする**: 上のアンチパターンのとおり、開発機と本番の差が隠れます。
- **CSV を `+09:00` にする**: 上のとおり、突き合わせのしやすさを取りました。
- **`application` で `Clock` を読む**: 時刻への依存が型に出ず、1 回の処理の中で時刻が複数になります。入口が 1 回読み、`now` で渡す形にしました。
- **`Temporal` の prototype に `toPostgres` を足す**: global の改変になります。書きは文字列で渡します。

## Consequences

- 入口の handler は、`currentInstant` を 1 回読んで `now` を渡します。テストは、入口なら固定の `Clock` か `TestClock.layer()` をランタイムに与え、`application` の関数なら `now` を値で渡します。[ADR 0028](0028-effect-in-application-and-infrastructure.md) の「使う」の表に `Clock` と `TestClock` を足しました。
- `Date` の値と `Temporal.Now` が、`domain` だけでなくアプリのコード全体で `vp check` に止められます。`globalThis.Date` と `globalThis.Temporal` も止まるので、[ADR 0027](0027-domain-model-as-pure-functions-and-unions.md) で止まらなかった `globalThis.Date.now()` も止まります。型の注釈の `Date` は止まりません。Better Auth や pg が `Date` を返すためです。
- web が gzip で 20.5 kB 増えます。Safari と iOS が組み込みの `Temporal` を出すまで、polyfill は外せません。
- 例外が 1 か所あります。`apps/api/src/auth/session.ts` の `sessionGuard` は、Better Auth の `session.createdAt`（`Date`）との差で絶対期限を見るため、`Date.now()` を disable comment 付きで読みます。HTTP のミドルウェアが Effect のランタイムを持たず、`createApp` に時計を注入する形にすると、`Date` を偽装する既存のテスト（`vi.useFakeTimers`）をすべて直すことになるためです（判断）。入口に `ManagedRuntime` を渡すようにしたとき（ADR 0028）に、`currentInstant` に替えます（[session.ts の Date.now() を、入口の Clock から読む形に替える](https://github.com/yokozi-jp/agent-software-factory/issues/404)）。
- `Clock` の読み取りを `application` で止める規則は、`Effect.clockWith` のような別の経路を止めません。レビューで見ます。
- 実施は、[日時とタイムゾーンの ADR を足し、ADR 0027、0028、docs、用語集を直す](https://github.com/yokozi-jp/agent-software-factory/issues/375)（この ADR）、[Temporal の土台と、日時の lint とテストのタイムゾーンを置く](https://github.com/yokozi-jp/agent-software-factory/issues/372)、[pg の日時の parser と kysely-codegen の型を Temporal にする](https://github.com/yokozi-jp/agent-software-factory/issues/373)、[web の Temporal と、業務のタイムゾーンでの表示を置く](https://github.com/yokozi-jp/agent-software-factory/issues/374) です。

## 出典

- 調査 [Node.js 24 とブラウザで日時とタイムゾーンを扱う方法を比べる](https://github.com/yokozi-jp/agent-software-factory/issues/364)（2026-10-29。Node.js 24.22.2 と 26.13.0、PostgreSQL 17、pg 8.23.1、temporal-polyfill 1.0.6、date-fns 4.4.0、@date-fns/tz 1.5.0）。
- 判断のチケットで足して確かめたこと（2026-10-29。zod 4.6.7、Effect 4.0.6）: `Temporal.Instant` の `JSON.stringify` がミリ秒の 0 の桁を落とすこと。zod の `z.iso.datetime()` が既定で `Z` だけを受けること。pg が `Temporal` の値を JSON の引用符付きの文字列で送り、PostgreSQL 17 がそれを受け付けること。`Layer.succeed(Clock.Clock)` と `TestClock` で時刻を固定できること。
- 実施で確かめたこと（2026-10-29。`@hono/zod-openapi`、Vite+ 1.4.0）: `.transform` の付いた `apiInstant` と `apiDate` が OpenAPI に `format: date-time` と `date` の文字列で出ること。`Temporal.Now.instant()`、`globalThis.Temporal.Now`、`const { Now } = Temporal` が lint に止まり、`Temporal.Instant` の型は止まらないこと。
- [PostgreSQL 17: 8.5 Date/Time Types](https://www.postgresql.org/docs/17/datatype-datetime.html)、[RFC 3339](https://www.rfc-editor.org/rfc/rfc3339)、[RFC 9557](https://www.rfc-editor.org/rfc/rfc9557.html)、[Vitest: Common Errors](https://vitest.dev/guide/common-errors)、[Node.js 26.0.0 のリリースノート](https://nodejs.org/en/blog/release/v26.0.0)。
