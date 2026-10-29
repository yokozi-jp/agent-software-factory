# Node.js 24 とブラウザで日時とタイムゾーンを扱う方法を比べる（Temporal の polyfill、date-fns と @date-fns/tz、Intl だけ）

## 問い

[Issue #364](https://github.com/yokozi-jp/agent-software-factory/issues/364) の調査。[締めのバッチの業務日付、照合、再実行、途中からの再開、オンラインとの排他を決める](https://github.com/yokozi-jp/agent-software-factory/issues/354) で、システム全体のタイムゾーンの扱いを別に決めることにした。その判断のチケットの入力として、次を一次情報と手元の試行で調べる。

- Node.js 24（このリポジトリの版、`package.json` の `engines.node` は `^24`）とブラウザで、IANA のタイムゾーン名を使って日時を計算し、書式にする方法。候補は `Temporal` の polyfill（`temporal-polyfill`、`@js-temporal/polyfill`）、date-fns と `@date-fns/tz`、`Intl.DateTimeFormat` だけ。
- 比べる軸: 業務のタイムゾーンでの月初と日の境界（夏時間のある名前を含む）、ISO 8601 と RFC 3339 と RFC 9557 の読み書き、bundle の大きさ、保守の状況と版、Vitest でタイムゾーンを固定して試す方法、Node.js 26 で組み込みの `Temporal` へ移れるか。
- `domain` が日時を受け取るときの型として各候補が使えるか（ADR 0027 の `Date` の禁止、ADR 0026 の「`domain` は何も import しない」）。
- PostgreSQL の `timestamptz` と `date` を、pg、Kysely、kysely-codegen がどの JS の型で返すか。
- 一次情報と `docs/db/postgresql-i18n.md`、`docs/logging/web-api.md`、`docs/web-api/response-body.md` の食い違い。

調べた日は 2026-10-29。手元の試行は Node.js 24.22.2（V8 13.6）と Node.js 26.13.0、PostgreSQL 17（`packages/db/src/testing/connection.ts` と同じ `postgres:17`）、pg 8.23.1（pg-types 2.2.0、postgres-date 1.0.7）、kysely-codegen 0.20.0、temporal-polyfill 1.0.6、@js-temporal/polyfill 0.5.1、date-fns 4.4.0、@date-fns/tz 1.5.0、esbuild 0.28.2、TypeScript 7.0.2 で行った。試行のスクリプトは `/tmp/dt` に置き、リポジトリには入れていない。

## 要約

- **組み込みの `Temporal`**: Node.js 26.0.0（2026-05-05）が既定で有効にした。Node.js 24 には無い（`typeof Temporal` は `undefined`）。`--harmony-temporal` を付けると Node.js 24 でも動いたが、V8 の harmony のフラグで、本番に使うものではない。ブラウザは Chrome 144、Firefox 139 から。Safari は Technology Preview だけで、iOS の Safari は未対応（MDN の browser-compat-data）。したがって、web はどの案でも当面 polyfill か別の library が要る。
- **月初、日の境界、夏時間**: 4 つの方式とも、`America/New_York` で「2026-04-01T03:30Z は業務日付 2026-03-31」「3 月の月初は 05:00Z、4 月の月初は 04:00Z」「2026-03-08 は 23 時間」を正しく出した。結果はプロセスの `TZ` に依らなかった。差は書きやすさと、存在しない時刻（夏時間の隙間）の扱いの選べる幅に出た。`Temporal` は `disambiguation: "reject"` で隙間を例外にできる。`@date-fns/tz` と Intl だけの自作は黙って後ろにずらす（自作は書き方次第）。
- **RFC 9557**: `Temporal.ZonedDateTime` だけが `2026-03-08T03:30:00-04:00[America/New_York]` を読み書きし、オフセットと名前が矛盾すると `RangeError` を出す。`Date.parse` は `NaN` を返す。date-fns の `parseISO` は**例外も `Invalid Date` も出さず、オフセットを捨てた誤った時刻（03:30Z、正しくは 07:30Z）を返した**。RFC 3339（`Z` と数値のオフセット）は、どの方式でも読める。
- **bundle**（esbuild で minify と gzip、月初を計算する同じ処理）: `temporal-polyfill/global` 20.5 kB、その tree-shake できる関数の API 9.6 kB、`@js-temporal/polyfill` 46.9 kB、date-fns と `@date-fns/tz` 7.3 kB、Intl だけ 0 kB。
- **保守**: temporal-polyfill は 1.0.6（2026-10-13）で、Node.js 16〜26 で CI を回し、test262 に意図した 2 件の差だけと README に書く。@js-temporal/polyfill は 0.5.1（2025-03-31）が最後で、README の roadmap の「production version を npm に出す」は未完、global にも入らない。date-fns 4.4.0（2026-05-29）、@date-fns/tz 1.5.0（2026-05-21、date-fns の monorepo に移った）。
- **`domain` との関係**: TypeScript 7.0.2 は `lib.esnext.temporal.d.ts` を持つので、`Temporal.Instant` や `Temporal.PlainDate` の型は import なしに global の型として使える。実体は入口（`apps/api`、`apps/web`、Vitest の setup）が `temporal-polyfill/global` で入れれば、`domain` は library を import しない。date-fns は関数を import しないと計算できず、`domain` には入れられない（ADR 0026）。Intl だけなら `domain` は branded の文字列を受け、計算は `application` に置く形になる。
- **pg と kysely-codegen**: pg は `timestamptz`、`timestamp`、`date` のどれも `Date` で返し、kysely-codegen の既定の型も 3 つとも `Timestamp`（`ColumnType<Date, Date | string, Date | string>`）。**`date` はプロセスのローカルの 0 時の `Date` になる**ので、`TZ=Asia/Tokyo` で `date '2026-03-31'` を読むと `2026-03-30T15:00:00.000Z` になり、そのまま JSON にすると前日に見える。Date を `$1::date` に送ると、プロセスの `TZ` で日付が変わる（`2026-04-01T03:30Z` は東京で 04-01、ニューヨークで 03-31）。
- **docs との食い違い**: `docs/web-api/response-body.md` の例は暦日の項目（`order_date`）を UTC の 0 時の日時 `2023-09-30T00:00:00Z` で返していて、上の pg の `date` の誤りを招く。`docs/db/postgresql-i18n.md` は UTC のオフセット（`INTERVAL`）を保存する例を挙げるが、オフセットだけでは夏時間の規則が残らず、RFC 9557 と Temporal は IANA の名前を持つ形を取る。詳しくは「docs との食い違い」の節。

## 組み込みの Temporal の状況

| 環境                          | 状況                                                                          | 出典                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js 24.22.2（V8 13.6）    | 既定では無い。`--harmony-temporal` で `ZonedDateTime` などが動いた（手元）    | 手元の試行                                                                                                                                                               |
| Node.js 26.0.0（V8 14.6）     | 既定で有効（`build: enable Temporal by default`、#61806）                     | [Node.js 26.0.0 のリリースノート](https://nodejs.org/en/blog/release/v26.0.0)                                                                                            |
| Chrome、Edge                  | 144 から                                                                      | [browser-compat-data の Temporal.json](https://raw.githubusercontent.com/mdn/browser-compat-data/main/javascript/builtins/Temporal.json)                                 |
| Firefox                       | 139 から                                                                      | 同                                                                                                                                                                       |
| Safari（macOS）               | `preview`（Technology Preview だけ）                                          | 同                                                                                                                                                                       |
| Safari（iOS）、iOS の WebView | 未対応（`false`）                                                             | 同                                                                                                                                                                       |
| TypeScript 7.0.2              | `lib.esnext.temporal.d.ts` があり、`esnext` が参照する。`es2024` には入らない | `node_modules` の `@typescript/typescript-linux-x64/lib/lib.esnext.d.ts`。temporal-polyfill の README も TypeScript 6.0 以降は `lib` に `esnext.temporal` を足す形を示す |

- このリポジトリの `apps/api`、`packages/*` の `tsconfig.json` は `lib: ["es2024"]`、`apps/web` は `["es2022", "dom", "dom.iterable"]` で、今は `Temporal` の型が見えない。
- 判断: Lambda の都合で Node.js 24 にしている（ADR 0013、[Node.js を 26 から 24 に下げる](https://github.com/yokozi-jp/agent-software-factory/issues/90)）ので、API 側は当面 polyfill か別の library が要る。Safari が組み込みを出しても、iOS の古い版が残るあいだ web は polyfill を外せない。

## 方式ごとの比較

試行のスクリプト（`/tmp/dt/compare.mjs`）は、業務のタイムゾーンを `America/New_York` にし、`TZ=Asia/Tokyo` と `TZ=UTC` で同じ結果になることを確かめた（date-fns の `parseISO` の RFC 9557 の行だけが表示のタイムゾーンで変わり、指す時刻は同じく誤っていた）。Node.js 24 と 26 で出力は同じだった。Node.js 26 の組み込みの `Temporal` も同じ値を返し、`import { Temporal } from "temporal-polyfill"` は組み込みと同じ object を返した。

| 軸                                    | temporal-polyfill 1.0.6                                                                                            | @js-temporal/polyfill 0.5.1                                   | date-fns 4.4.0 と @date-fns/tz 1.5.0                                                 | Intl だけ                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 瞬間から業務日付                      | `instant.toZonedDateTimeISO(zone).toPlainDate()`                                                                   | 同じ                                                          | `formatISO(d, { representation: "date", in: tz(zone) })`                             | `formatToParts` の `year`、`month`、`day`                                                         |
| 業務のタイムゾーンの月初の瞬間        | `zdt.with({ day: 1 }).startOfDay().toInstant()`                                                                    | 同じ                                                          | `startOfMonth(d, { in: tz(zone) })`                                                  | 自作。壁時計の 0 時を UTC と仮定し、`formatToParts` で求めたオフセットで 2 回補正する（約 20 行） |
| 夏時間の日の長さ                      | `hoursInDay` が 23                                                                                                 | 同じ                                                          | `differenceInHours` が 23                                                            | 自作の差で 23                                                                                     |
| 存在しない時刻（2026-03-08T02:30 NY） | 既定 `compatible` で 03:30-04:00。`disambiguation: "reject"` で `RangeError`                                       | 同じ（文言だけ違う）                                          | `new TZDate(…, 2, 30, zone)` は 03:30-04:00 に黙ってずらす。選ぶ引数は README に無い | 自作の書き方次第                                                                                  |
| RFC 3339 を読む                       | `Temporal.Instant.from`                                                                                            | 同じ                                                          | `parseISO`（読めた）                                                                 | `Date.parse`（読めた）                                                                            |
| RFC 9557 を読む                       | `ZonedDateTime.from`。オフセットと名前の矛盾は `RangeError`                                                        | 同じ                                                          | `parseISO` は誤った時刻を黙って返す（例外も `Invalid Date` も無い）                  | `Date.parse` は `NaN`                                                                             |
| 書く                                  | `Instant#toString` は `Z` の RFC 3339、`ZonedDateTime#toString` は RFC 9557、`PlainDate` は `YYYY-MM-DD`           | 同じ                                                          | `formatISO`、`TZDate#toISOString` はオフセット付き                                   | `Date#toISOString`。暦日は `formatToParts` から組む                                               |
| 表示の書式（ロケール）                | `toLocaleString` と `Intl.DateTimeFormat`                                                                          | 同じ（`Intl` も差し替えて export する）                       | `format`（date-fns のトークン）か `Intl`                                             | `Intl.DateTimeFormat`                                                                             |
| bundle（min / gzip、手元の esbuild）  | global 59.2 / 20.5 kB。関数の API（`fns/*`）9.6 kB                                                                 | 162.2 / 46.9 kB                                               | 24.9 / 7.3 kB                                                                        | 0                                                                                                 |
| bundle（README の値）                 | 19.5 kB、`/full/` 23.3 kB                                                                                          | 52.1 kB（temporal-polyfill の README の比較表）               | `TZDate` 1.2 kB、`TZDateMini` 916 B（`@date-fns/tz` の README）                      | —                                                                                                 |
| global に入るか                       | `temporal-polyfill/global`。組み込みがあれば組み込みを使う                                                         | 入らない（README）。import した object を使う                 | —                                                                                    | —                                                                                                 |
| 保守                                  | 1.0.6（2026-10-13）。CI は Node.js 16〜26。spec の日付 2026-10                                                     | 0.5.1（2025-03-31）。spec の日付 2025-03。production 版は未完 | date-fns 4.4.0（2026-05-29）、@date-fns/tz 1.5.0（2026-05-21）                       | —                                                                                                 |
| Node.js 26 で組み込みへ移る           | global と ponyfill は組み込みを使うので、import を消すだけ。関数の API は codemod（`fns-to-temporal`）が書き換える | 自分の class を使い続けるので、import を書き換える            | 移行の道具は無い。呼び出しを書き直す                                                 | 自作の補正を `Temporal` に書き直す                                                                |
| Vitest                                | ESM だけ。既定の `forks` で動く。`vmForks`、`vmThreads` は Vitest 5 と Node.js 24.9 以降（README）                 | 確かめていない                                                | 確かめていない（`Date` の拡張なので特別な要件は README に無い）                      | —                                                                                                 |

出典: [temporal-polyfill の README](https://github.com/fullcalendar/temporal-polyfill/blob/main/polyfill/README.md)、[temporal-polyfill の monorepo の README](https://github.com/fullcalendar/temporal-polyfill/blob/main/README.md)、[@js-temporal/polyfill の README](https://github.com/js-temporal/temporal-polyfill/blob/main/README.md)、[@date-fns/tz の README](https://github.com/date-fns/tz/blob/main/README.md)、版と日付は npm の registry（`npm view <名前> version time.modified`）。

### 判断として読めること

- 計算の正しさは 4 つとも同じで、差は「誤りを型と例外で止められるか」に出る。`Temporal` は瞬間（`Instant`）、暦日（`PlainDate`）、名前付きの日時（`ZonedDateTime`）を別の型にし、隙間と RFC 9557 の矛盾を例外にできる。date-fns は値がすべて `Date` で、暦日と瞬間を型で分けられない。`parseISO` が RFC 9557 を誤って読むので、外から RFC 9557 を受けるなら使えない（判断）。
- `@js-temporal/polyfill` は、大きさが temporal-polyfill の約 2.3 倍で、1 年半 release が無く、global にも入らないので、選ぶ理由が見当たらない（判断）。
- Intl だけは依存が増えないが、月初の瞬間を求める補正を自作し、その境界値のテストを持つことになる。既製の library の誤りを避ける代わりに、自作の誤りを抱える（判断）。

## Vitest と Playwright でタイムゾーンを固定する

- Vitest の `test.env` や setup file で `process.env.TZ` を変えても、`threads` と `vmThreads` の pool では `Date` のタイムゾーンは変わらない。Node.js は main thread で設定したときだけ `TZ` を適用する。shell、設定ファイルの先頭、`globalSetup` のどれかで、worker が起動する前に決める。テストごとに変えるなら `forks` か `vmForks` にするか、`Intl.DateTimeFormat` に `timeZone` を渡す（[Vitest の Common Errors「Time Zone Does Not Change in Worker Threads」](https://vitest.dev/guide/common-errors)、[test.env](https://vitest.dev/config/env)）。
- browser mode（Playwright の provider）は、`playwright({ contextOptions: { … } })` が `browser.newContext()` に渡る。context はテストのファイルごとに作られる（[Configuring Playwright](https://vitest.dev/config/browser/playwright)）。Playwright の `timezoneId` は context のタイムゾーンを変える（[TestOptions.timezoneId](https://playwright.dev/docs/api/class-testoptions)）。`contextOptions.timezoneId` で web の component test のタイムゾーンを固定できるはずだが、このリポジトリの設定では試していない。
- 判断: 業務のタイムゾーンを引数で渡す書き方（`Temporal` の `toZonedDateTimeISO(zone)`、`@date-fns/tz` の `tz(zone)`、`Intl` の `timeZone`）なら、計算はプロセスの `TZ` に依らない。試行でもそうだった。プロセスの `TZ` に頼る残りは pg の `date` と `timestamp` の読み書き（次の節）で、これはテストで `TZ` を UTC 以外に固定すると見つかる。

## PostgreSQL、pg、Kysely、kysely-codegen の型

| PostgreSQL の型 | pg 8.23.1 が返す値（pg-types 2.2.0）           | kysely-codegen 0.20.0 の既定の型 | `--date-parser string`（`dateParser: "string"`） |
| --------------- | ---------------------------------------------- | -------------------------------- | ------------------------------------------------ |
| `timestamptz`   | `Date`（オフセットで UTC に直す）              | `Timestamp`                      | 変わらない                                       |
| `timestamp`     | `Date`（プロセスのローカルの時刻として読む）   | `Timestamp`                      | 変わらない                                       |
| `date`          | `Date`（プロセスのローカルの 0 時）            | `Timestamp`                      | `string`                                         |
| `'infinity'`    | `Infinity`（`Number`）。型の `Date` と合わない | —                                | —                                                |

- pg-types は OID 1082（`date`）、1114（`timestamp`）、1184（`timestamptz`）に postgres-date の `parseDate` を登録する。postgres-date はオフセットの無い文字列を `new Date(year, month, day, …)` でローカルの時刻として作り、`YYYY-MM-DD` も「local time として読む」とコメントに書いて同じく作る（`pg-types/lib/textParsers.js`、`postgres-date/index.js`）。node-postgres の文書も、`timestamp` と `date` は Node のプロセスのローカルの時刻に変えると書く（[node-postgres: Data Types](https://node-postgres.com/features/types)）。
- 手元の試行（`TZ` を変え、セッションの `TimeZone` は `Etc/UTC`）:

  | プロセスの `TZ`    | `timestamptz '2026-03-31 23:30-04'` | `timestamp '2026-03-31 23:30'` | `date '2026-03-31'`        | `Date('2026-04-01T03:30Z')` を `$1::date` に送る |
  | ------------------ | ----------------------------------- | ------------------------------ | -------------------------- | ------------------------------------------------ |
  | `UTC`              | `2026-04-01T03:30:00.000Z`          | `2026-03-31T23:30:00.000Z`     | `2026-03-31T00:00:00.000Z` | `2026-04-01`                                     |
  | `Asia/Tokyo`       | 同じ                                | `2026-03-31T14:30:00.000Z`     | `2026-03-30T15:00:00.000Z` | `2026-04-01`                                     |
  | `America/New_York` | 同じ                                | `2026-04-01T03:30:00.000Z`     | `2026-03-31T04:00:00.000Z` | `2026-03-31`                                     |

  `pg.types.setTypeParser(1082, (v) => v)` にすると、`date` は `TZ` に依らず `"2026-03-31"` の文字列になった。

- kysely-codegen の `dateParser: "string"` は、生成する型を `string` にし、**codegen が自分で開く接続にだけ** `setTypeParser(1082, …)` を掛ける（`dist/introspector/dialects/postgres/postgres-dialect.js`）。アプリの接続には掛からないので、型と実際の値をそろえるには、アプリの pg の初期化でも同じ parser を登録する必要がある。kysely-codegen には `--type-mapping` もあり、help の例は `{"timestamptz":"Temporal.Instant"}`（`dist/cli/flags.js`）。値を `Temporal.Instant` にするには、これも pg の parser を別に書く。
- Kysely 自身は値を変換しない。変換は driver（pg）が行う。
- このリポジトリの今: `packages/db/src/types.ts` は `dateParser` を指定しておらず既定の `timestamp`、`packages/*/src/infrastructure/db.gen.ts` の時刻の列は `Timestamp`。`setTypeParser` はリポジトリのどこにも無い。今の migration に `date` の列は無い。
- PostgreSQL は、`timestamptz` の入力を UTC に直して保存し、入力で示した、または仮定したタイムゾーンを残さない。出力はセッションの `TimeZone` に直す（[PostgreSQL 17: 8.5.1.3 Time Stamps](https://www.postgresql.org/docs/17/datatype-datetime.html)）。

## `domain` との関係

ADR 0027 は `domain` の `Date` の値（`new Date()`、`Date.now()`）を止め、ADR 0026 は `domain` が何も import しないことを求める。`vite.config.ts` の `domain` の override の `no-restricted-globals` は、`Date` に「Take the time as an argument, a branded `Instant`」と案内する。`docs/domain-model/types.md` の例も `submittedAt: Instant`、`now: Instant` を使う。

| 候補                     | `domain` が受け取る型                                                                                          | import の規則との関係                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| temporal-polyfill        | `Temporal.Instant`、`Temporal.PlainDate`、`Temporal.ZonedDateTime`。どれも不変                                 | 型は `lib` に `esnext.temporal` を足せば global の型として import なしに使える。実体は入口が `temporal-polyfill/global` で入れる。`domain` のテストも Vitest の setup で入れる |
| @js-temporal/polyfill    | 同じ形の class                                                                                                 | global に入らないので、`domain` が import することになる                                                                                                                       |
| date-fns と @date-fns/tz | `Date`（`TZDate` も `Date` の subclass）。型の注釈の `Date` は lint に掛からない（ADR 0027 の確かめ）          | 計算の関数を import するので、`domain` では計算できない。計算は `application` に置き、`domain` は結果だけを受ける                                                              |
| Intl だけ                | branded の文字列（例: `Z` の RFC 3339 の瞬間、`YYYY-MM-DD` の暦日）。同じ形の UTC の文字列は辞書順で比べられる | import は無い。`Intl` は止めていない。タイムゾーンの計算は `application` に置く形になる                                                                                        |

- 判断: `Temporal` の global を使う場合、`Temporal.Now` は `Date.now()` と同じく現在時刻を読むので、`domain` では `no-restricted-properties` で止める必要がある。`globalThis.Date.now()` が止まらないのと同じく、`globalThis.Temporal.Now` は今の規則の書き方では止まらない見込み（試していない）。
- 判断: docs の branded の `Instant` は、`Temporal.Instant` と名前が重なる。`Temporal` を採るなら branded の型をやめるか、名前を変えるかを決める。

## docs との食い違い

| 文書                            | 記述                                                                                                                          | 一次情報と試行                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/web-api/response-body.md` | 日付は ISO 8601 で返す。例の `order_date` は `"2023-09-30T00:00:00Z"`                                                         | ISO 8601 で返すことは RFC 3339 と合う。ただし `order_date` は暦日で、RFC 3339 には `full-date`（`2023-09-30`）がある。暦日を UTC の 0 時の瞬間で表すと、UTC より西のタイムゾーンで前日に見える。pg の `date` の既定（ローカルの 0 時の `Date`）を JSON にしても同じ誤りが出る（上の表の `Asia/Tokyo` の行）                                                                                                |
| `docs/db/postgresql-i18n.md`    | `timestamptz` は内部で UTC にするので、操作したときのタイムゾーンを別に持つ。例は `utc_offset INTERVAL`。「夏時間は廃止方向」 | `timestamptz` がタイムゾーンを残さないことは PostgreSQL の文書のとおり。ただし、残すものがオフセットだけだと、その地域の夏時間の規則（翌月初や翌日の境界）を計算できない。RFC 9557 は IANA の名前を suffix に持つ形を定め、`Temporal.ZonedDateTime` も名前を持つ。「夏時間は廃止方向」は一次情報を確かめていない。IANA の tz database の `America/New_York` は 2026 年も夏時間を持つ（試行の 23 時間の日） |
| `docs/db/postgresql-i18n.md`    | 例: 8:00 に買ったものを UTC で保存すると、夏時間が始まってから見ると 9:00 と出る                                              | IANA の名前で書式にすれば、`Intl.DateTimeFormat` と `Temporal` はその瞬間のオフセットを使うので、9:00 にはならない。9:00 になるのは、今のオフセットで固定して直したとき（判断。試行の書式の結果から）。利用者のタイムゾーンと表示のタイムゾーンが違うときに、どちらで見せるかの問題は残る                                                                                                                  |
| `docs/logging/web-api.md`       | タイムスタンプは ISO 8601 でミリ秒まで、UTC（`Z`）か JST（`+09:00`）                                                          | 食い違いは無い。`Date#toISOString` と `Temporal.Instant#toString` は `Z` の RFC 3339 を出す。`docs/logging/keys.md` の例はナノ秒（`.123456789Z`）で、ミリ秒の規定と桁が違う（`Date` はミリ秒まで、`Temporal.Instant` はナノ秒まで持てる）                                                                                                                                                                  |

## 決めるべき論点

1. API と web で、日時を何の型で持つか。`Temporal`（temporal-polyfill の global）、date-fns と `@date-fns/tz`、Intl だけと branded の文字列のどれか。web は Safari のため、どれでも当面 polyfill か library が要る。
2. 業務のタイムゾーンをどこに持つか。テナントごとか、システムで 1 つか（`docs/batch/business-date-timezone.md` は、複数を扱うなら業務日付の PK にタイムゾーンを足す）。持つのはオフセットではなく IANA の名前にするか。
3. API の JSON の形。瞬間は `Z` の RFC 3339、暦日は `full-date`、名前付きの日時が要るなら RFC 9557 にするか。`docs/web-api/response-body.md` の例を直すか。
4. pg の `date`（OID 1082）を文字列で返す parser を、アプリの接続に登録するか。kysely-codegen の `dateParser: "string"` と組にするか。`timestamptz` を `Temporal.Instant` に変える parser と `--type-mapping` まで入れるか。`timestamp`（タイムゾーン無し）を使わない規則にするか。
5. `domain` が受け取る型。`Temporal` を採るなら、`domain` の `tsconfig` の `lib` に `esnext.temporal` を足し、`Temporal.Now` を lint で止め、docs の branded の `Instant` をどうするか。
6. テストのタイムゾーン。Vitest の node の project を `TZ` を UTC 以外（例: `America/New_York` か `Asia/Tokyo`）に固定して pg のローカルの時刻の誤りを見つけるか、UTC に固定するか。web の browser mode の `timezoneId` をどうするか。
7. Node.js 26 に上げるとき（Lambda Web Functions が対応したら）、組み込みの `Temporal` に移る手順。temporal-polyfill の global なら import を消すだけになる。

## 確かめられなかった点

- Vitest 5.0.5 の browser mode で `contextOptions.timezoneId` が効くこと。このリポジトリの設定では試していない。
- `@js-temporal/polyfill` と date-fns を Vitest の `vmForks`、`vmThreads` で動かせるか。
- `globalThis.Temporal.Now` を Oxlint の今の規則で止められるか。
- temporal-polyfill の保守者の人数。README の作者欄は 1 人（arshaw）だが、貢献者の数は数えていない。
- Safari の組み込みの `Temporal` が安定版に入る時期。browser-compat-data は `preview` とだけ書く。
- 「夏時間は廃止方向」の一次情報。
- 本番の Aurora PostgreSQL のセッションの `TimeZone` の既定（手元の `postgres:17` は `Etc/UTC`）。`timestamptz` の読み書きには効かないが、`timestamp` と `date` への変換と `AT TIME ZONE` の無い集計には効く。

## 出典

- [Node.js 26.0.0 (Current) のリリースノート](https://nodejs.org/en/blog/release/v26.0.0)
- [MDN browser-compat-data: javascript/builtins/Temporal.json](https://raw.githubusercontent.com/mdn/browser-compat-data/main/javascript/builtins/Temporal.json)
- [temporal-polyfill の README](https://github.com/fullcalendar/temporal-polyfill/blob/main/polyfill/README.md)、[monorepo の README](https://github.com/fullcalendar/temporal-polyfill/blob/main/README.md)
- [@js-temporal/polyfill の README](https://github.com/js-temporal/temporal-polyfill/blob/main/README.md)
- [@date-fns/tz の README](https://github.com/date-fns/tz/blob/main/README.md)
- [RFC 9557: Date and Time on the Internet: Timestamps with Additional Information](https://www.rfc-editor.org/rfc/rfc9557.html)
- [PostgreSQL 17: 8.5 Date/Time Types](https://www.postgresql.org/docs/17/datatype-datetime.html)
- [node-postgres: Data Types](https://node-postgres.com/features/types)、pg-types 2.2.0 の `lib/textParsers.js`、postgres-date 1.0.7 の `index.js`（npm の tarball）
- kysely-codegen 0.20.0 の `dist/cli/flags.js`、`dist/introspector/dialects/postgres/postgres-dialect.js`、`dist/generator/dialects/postgres/postgres-adapter.js`（npm の tarball）
- [Vitest: Common Errors](https://vitest.dev/guide/common-errors)、[Vitest: env](https://vitest.dev/config/env)、[Vitest: Configuring Playwright](https://vitest.dev/config/browser/playwright)
- [Playwright: TestOptions](https://playwright.dev/docs/api/class-testoptions)
