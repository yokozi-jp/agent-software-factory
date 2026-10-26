# TypeScript で関数型ドメインモデリングを書く方式と library を比べる

## 問い

[Issue #219](https://github.com/yokozi-jp/agent-software-factory/issues/219) の調査。Scott Wlaschin『Domain Modeling Made Functional』（DMMF）の流儀を TypeScript で書く方式と library を、一次情報で比べる。結果は [Issue #220](https://github.com/yokozi-jp/agent-software-factory/issues/220)（ドメインモデルの書き方を決める）の材料にする。この文書は決定をしない。

調べる項目は 6 つ。

1. 型で状態と制約を表す書き方（判別可能な union、branded type、smart constructor、zod との共有）。
2. 失敗の表し方（`Result` の library と自作の比較）。
3. ワークフローの書き方（純粋な関数のパイプライン、I/O を端に寄せる形、依存の渡し方）。
4. 検査できるか（`throw` の禁止、`Result` を捨てない）。
5. テスト（fast-check との組み合わせ）。
6. 公開の事例とアンチパターン。

調べた日は 2026-10-26。前提は ADR 0007（Web 標準の API だけで書く）、ADR 0020（`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`no-unsafe-type-assertion`）、ADR 0025（Kysely）、Issue #147（API の入力は `@hono/zod-openapi`）。

「確かめた」は、2026-10-26 に `/tmp/fdm`（リポジトリの外）で実際に動かした結果。「判断」は私の見立てで、一次情報の言明ではない。

## 要約

- 型の書き方（1）: 判別可能な union で状態を表し、`switch` の網羅は ADR 0020 の `switch-exhaustiveness-check` が止める（確かめた）。branded type は、このリポジトリの `no-unsafe-type-assertion` が `n as Amount` を止める（確かめた）ので、`as` を使わない作り方が要る。通ったのは、zod の `.brand()` と、型述語（`s is Email`）の smart constructor。zod の branded schema は `@hono/zod-openapi` の `c.req.valid("json")` まで型を保って届く（確かめた）。
- 失敗の表し方（2）: 候補のうち、neverthrow は 2025-02-21 の 8.2.0 が最後のリリースで、その後の commit は README だけ（確かめた）。byethrow は 2026-06-08 の 0.12.0 が最新で、0.x。Effect は 2026-10-01 に 4.0.0 が出て最新は 4.0.6。option-t は 2026-05 の 56.1.2。どれも strict な tsconfig（ADR 0020 と同じ設定）で型検査を通った（確かめた）。bundle は、Result だけなら自作が 124 B、option-t が 231 B、true-myth が 755 B、byethrow が 1.6 KB、neverthrow が 2.1 KB、Effect の `Result` だけで 6.3 KB、Effect の runtime を入れると 31 KB（gzip、確かめた）。
- 検査（4）: `no-floating-promises` は Oxlint（tsgolint）で動く。ただし既定では neverthrow の `ResultAsync`（thenable）を見逃し、`checkThenables: true` を足すと止まる（確かめた）。同期の `Result` を捨てることと、`await` した `Result` を捨てることは、Oxlint の組み込みの規則では止まらない（確かめた）。`throw` の禁止は、Oxlint に `no-restricted-syntax` がなく、自作の JS plugin（5 行）なら止まる（確かめた）。
- ワークフロー（3）とテスト（5）: DMMF は依存を関数の引数で渡す（Wlaschin の「依存の 6 つの渡し方」の 3 つ目）。fast-check と vitest は、`Result` と branded 値の組み合わせで動いた（確かめた）。zod から fast-check の arbitrary を作る library は、zod 4 に対応するのが `@traversable/zod-test`（0.0.28）だけで、他は zod 3 まで（確かめた）。
- 事例（6）: TypeScript で DMMF を移した公開リポジトリは見つかったが、星が 0〜2 の学習用の見本が中心。本番の事例として確かめられたのは、Effect を使う企業の自社の記事（Inato、14.ai）だけ。Wlaschin 自身が「`Result` をどこにでも使うな」と書いている。

## 1. 型で状態と制約を表す

### 標準の慣行と出典

- 「不正な状態を表せなくする」のが DMMF の中心の考え方（[Designing with types: Making illegal states unrepresentable](https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/)）。書籍は [Domain Modeling Made Functional](https://pragprog.com/titles/swdddf/domain-modeling-made-functional/)、講演の資料は [fsharpforfunandprofit.com/ddd](https://fsharpforfunandprofit.com/ddd/)。
- TypeScript で F# の判別共用体に当たるのが判別可能な union。`switch` で絞り込める（[TypeScript Handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)）。
- TypeScript は構造的型付けなので、名前で区別する型（F# の single-case DU）は branded type で真似る。zod は公式にこれを `.brand()` として持ち、「実行時の `.parse` の結果は変わらない。静的な型だけ」と書く（[Zod: Branded types](https://zod.dev/api)）。Effect は `Brand` と `Schema.brand` を持つ（[Effect: Branded Types](https://effect.website/docs/code-style/branded-types/)）。
- 判断: TypeScript 本体に branded type の公式の書き方はない。branded type は慣行であり、標準ではない。

### 確かめた結果

状態（draft、submitted、approved）を `z.discriminatedUnion("status", [...])` で書き、`approve(e: Extract<Expense, {status: "submitted"}>)` のように遷移の入力の型を状態で絞り、`switch` で全状態を分岐した。strict な tsconfig（ADR 0020 の全フラグ）で `tsc`（TypeScript 7.0.2）が通り、Oxlint（1.89.0、tsgolint 7.0.2005）の `switch-exhaustiveness-check` も通った。

| 書き方                                                                    | `as` 禁止（`no-unsafe-type-assertion`）の下で                                          | 備考                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `n as Amount`（手書きの smart constructor）                               | 止まる（`Unsafe type assertion: type 'Amount' is more narrow than the original type`） | neverthrow、byethrow、option-t、ts-results-es、true-myth、自作、Effect のどの例でも同じ |
| 型述語 `const isEmail = (s: string): s is Email => ...` を `if` で使う    | 通る                                                                                   | 述語の中身が検証になる。述語の本体を書き間違えても型は検出しない                        |
| zod `z.number().int().positive().brand<"Amount">()` と `Amount.safeParse` | 通る                                                                                   | 検証と型の付与が 1 か所。API の入力と同じ schema を使える                               |
| Effect `Schema.Number.check(...).pipe(Schema.brand("Amount"))`            | 通る                                                                                   | Effect 4.0.6 の `effect/Schema`。`Schema.decodeUnknownResult` で `Result` が返る        |

- 確かめた（zod と API）: `@hono/zod-openapi` 1.6.3 の `createRoute` に `z.object({ amount: Amount })`（`Amount` は branded schema）を渡すと、handler の `c.req.valid("json").amount` が `Amount` 型で、`(a: Amount) => ...` に渡せた。`@hono/zod-openapi` の peer は zod `^4.0.0`。
- 確かめた（落とし穴）: zod の `z.string().optional()` から導いた型は `memo?: string | undefined` で、`{ memo: undefined }` を代入できる。`exactOptionalPropertyTypes` が止めたい形を、zod 由来の型は許す。
- 判断: ドメインの値オブジェクトを zod の schema にすると、境界の検証（Issue #147）と共有できる。一方、ドメインの型が zod の `z.infer` に依存する。ドメインを zod から離したい場合は、型述語か自作の smart constructor を書き、zod 側で `.refine` や `.transform` から呼ぶ形になる。この選択は #220 の論点。
- Standard Schema（[standardschema.dev](https://standardschema.dev/)）は、zod、valibot、arktype、Effect Schema が共通の検証の interface を持つ仕様。`@praha/byethrow` は型だけ `@standard-schema/spec` に依存する（確かめた、`package.json` の dependencies）。

## 2. 失敗の表し方

### 標準の慣行と出典

- `Result`（Either）で「予期できる失敗」を値にする形は、DMMF の中心の一つ（[Railway Oriented Programming](https://fsharpforfunandprofit.com/rop/)）。
- Wlaschin 自身が、`Result` を使わない場合を挙げる（[Against Railway-Oriented Programming](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/)）。診断（stack trace）が要るとき、例外の代わりにするとき、すぐ止めたいとき、外から見えないとき、誰もエラーの種類を気にしないとき。「`Result` は予期した制御の流れのためで、予期しない状況のためではない」と書く。
- 判断: 「ドメインの失敗は `Result`、バグと環境の故障（DB 接続切れなど）は例外」という分け方が、上の出典と合う。この分け方は #220 で決める。

### 候補の比較（2026-10-26 に確かめた）

| 候補                                                           | 最新版と日付                             | リポジトリの状態                                                 | 週間 download（2026-10-16〜22） | bundle（gzip）                                                                              | 特徴                                                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 自作（判別可能な union 2 つ）                                  | なし                                     | なし                                                             | なし                            | 124 B                                                                                       | 他の候補の中身は無し。連鎖の関数（`andThen` など）は自分で書く                                                                          |
| [option-t](https://github.com/option-t/option-t)               | 56.1.2（2026-05-12）                     | push 2026-10-12、星 361、open issue 33。`sideEffects: false`     | 14,371                          | 231 B（`andThen`、`map`、`mapErr` を個別 import）                                           | `{ok, val/err}` の plain object。関数を個別に import する形。Rust の `Result` に近い                                                    |
| [true-myth](https://github.com/true-myth/true-myth)            | 9.4.0（2026-05-25）                      | push 2026-10-22、星 1,369                                        | 410,497                         | 755 B                                                                                       | クラスのメソッドで連鎖。`Maybe` と `Result`                                                                                             |
| [@praha/byethrow](https://github.com/praha-inc/byethrow)       | 0.12.0（2026-06-08）                     | push 2026-10-26、星 377。0.x                                     | 11,486                          | 1.6 KB                                                                                      | plain object の `Result`。`Result.pipe` と関数で連鎖。Oxlint の plugin `@praha/byethrow-oxlint` が同じリポジトリにある                  |
| [neverthrow](https://github.com/supermacro/neverthrow)         | 8.2.0（2025-02-21）                      | 最後の push 2026-02-14（README の変更）、星 7,756、open issue 83 | 2,207,892                       | 2.1 KB                                                                                      | クラスのメソッドで連鎖。`ResultAsync` は thenable。`safeTry` の generator                                                               |
| [ts-results-es](https://github.com/lune-climate/ts-results-es) | 7.1.0（2026-07-01）                      | push 2026-10-25、星 135。GitHub の Release はない                | 22,819                          | 2.6 KB                                                                                      | Rust 風のクラス                                                                                                                         |
| [Effect](https://github.com/Effect-TS/effect)                  | 4.0.6（2026-10-22）。4.0.0 は 2026-10-01 | push 2026-10-26、星 17,391                                       | 31,551,008                      | `Result` だけ 6.3 KB、`Schema` と `Result` で 24.9 KB、`Effect` の runtime を使うと 31.2 KB | `Effect` は失敗、依存、並行を型で持つ。v4 で `Result` が単独の module（旧 `Either`）。fp-ts は Effect に合流（下記）                    |
| [fp-ts](https://github.com/gcanti/fp-ts)                       | 2.16.11（2025-08-18）                    | 最後の push 2026-04-20、星 11,546                                | 2,678,428                       | 測っていない                                                                                | README が「Effect-TS に合流する。Effect は fp-ts v3 に当たる」と書く（[README](https://github.com/gcanti/fp-ts/blob/master/README.md)） |

- bundle は `esbuild --bundle --minify --platform=browser` で、同じ処理（`andThen`、`map`、`mapErr` の連鎖）を 1 つ書いて測った。tree shaking の効き方は import の仕方で変わる。zod は `import { z } from "zod"` で 454 KB（gzip 92 KB）、`zod/mini` で 9.2 KB（gzip 3.5 KB）だった。サーバー側（Lambda、ECS）では bundle の大きさの重みは小さい。判断: 重みが出るのは、ブラウザに同じドメインのコードを送る場合と、Lambda の起動時間。
- 保守の判断: neverthrow は利用者が最も多いが、本体のリリースは 20 か月ない。Result の機能は成熟しており、変更が要らない可能性もある。ただし、2026-02 以降の commit が README だけであること以外に、保守の方針（停止、安定のどちらか）を述べた一次情報は見つからなかった。
- 学習の費用（判断）: 自作と option-t と byethrow は plain object なので、`if (r.ok)` の絞り込みで読める。クラスのメソッドで連鎖する neverthrow、true-myth、ts-results-es は、`andThen`、`map` を覚えれば読める。Effect は `Effect`、`Layer`、`Schema`、generator（`Effect.gen`）の概念が増える。Effect 4 は 2026-10-01 に出たばかりで、v3 から package の構成と import の仕方が変わった（[MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)）。学習データに v3 の書き方が多い可能性があり、エージェントが v3 の API を書く恐れがある（判断、確かめていない）。
- エージェントが書き誤りやすい点（確かめたものだけ）:
  - `as` で branded 値を作る。このリポジトリでは `no-unsafe-type-assertion` が止める。止まったあと `oxlint-disable` で逃げる恐れがある（ADR 0020 の「抜け道」に記載）。
  - 同期の `Result` を捨てる。Oxlint の組み込みの規則では止まらない（4 を参照）。
  - neverthrow の `ResultAsync` を `await` せずに捨てる。既定の設定では止まらない（4 を参照）。
  - zod の `.optional()` が明示的な `undefined` を許す（1 を参照）。

## 3. ワークフローの書き方

### 標準の慣行と出典

- DMMF は、ワークフローを「入力の型から出力の型への関数」にして、小さな関数をパイプラインでつなぐ。検証、価格計算、確認のような段階を関数に分け、`Result` を返す関数は railway-oriented の `bind` でつなぐ（[Railway Oriented Programming](https://fsharpforfunandprofit.com/rop/)、[講演の資料](https://fsharpforfunandprofit.com/ddd/)）。
- 依存の渡し方は、Wlaschin が 6 つ挙げる（[Six approaches to dependency injection](https://fsharpforfunandprofit.com/posts/dependencies/)）。保持（全部を埋め込む）、拒否（コアに依存を持たせず、I/O を端に置く）、パラメータ化（依存を関数の引数で渡す）、注入と Reader、解釈（free monad）。DMMF の書籍は、依存を関数の引数で渡す形を使う。
- 「functional core, imperative shell」は Gary Bernhardt の講演 [Boundaries](https://destroyallsoftware.com/talks/boundaries) が出典。純粋な核と、I/O を持つ外側に分ける。Wlaschin の「依存の拒否」と同じ考え方。Google の Testing Blog も同じ形を勧める（[Functional Core, Imperative Shell](https://testing.googleblog.com/2025/10/simplify-your-code-functional-core.html)）。

### このリポジトリとの接点（確かめた事実と判断）

- 確かめた: ADR 0007 は `apps/api/src` を Web 標準の API だけで書く規則を持つ。ADR 0025 は、Kysely の `Kysely<DB>` を受け取るクエリのコードを `apps/api` に置く（`Pool` を作るのは入口のファイルだけ）。ADR 0013 は Outbox を SQS に送る処理を 1 つの関数にする。[Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) は、業務の更新と Outbox の挿入を同じトランザクションで行う。
- 判断: 純粋なドメイン関数が「状態と command から、新しい状態と event の配列を返す」形なら、`Kysely` のトランザクション（[Kysely: Simple transaction](https://kysely.dev/docs/examples/transactions/simple-transaction)）の中で、シェルが「読む → 核を呼ぶ → 状態と Outbox を書く」を行う形にできる。Outbox に入れる event は、核が返す値になる。
- 依存を渡す方式の選択肢（判断）: (a) 関数の引数（`save: (e: Expense) => Promise<Result<void, DbError>>` のような型を、ドメインの側で宣言する）。(b) Effect の `Layer` と `Context`（`Effect` を使うときの標準）。(c) 核に依存を持たせず、シェルが読み書きする（拒否）。ライブラリを足さずに済むのは (a) と (c)。(b) は Effect を採ることとセットになる。

## 4. 検査できるか

### 確かめた結果

環境は `/tmp/fdm`、Oxlint 1.89.0、oxlint-tsgolint 7.0.2005、TypeScript 7.0.2。`oxlint --type-aware` で、各 library の `Result` を捨てるコードを検査した。

| 検査したい違反                                                                               | 結果                                                                                                                                                                                                                                                                                                            | 出典                                                                                                                           |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Promise<Result>` を `await` せずに捨てる（byethrow の `ResultAsync`、option-t の async 版） | `typescript/no-floating-promises` が止める。ADR 0020 の「correctness は警告、`denyWarnings` で失敗」に乗る                                                                                                                                                                                                      | [Oxlint: no-floating-promises](https://oxc.rs/docs/guide/usage/linter/rules/typescript/no-floating-promises.html)              |
| neverthrow の `ResultAsync`（thenable）を捨てる                                              | 既定の設定では止まらない。`["error", {"checkThenables": true}]` を足すと止まる                                                                                                                                                                                                                                  | [typescript-eslint: no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/)（`checkThenables` の説明） |
| 同期の `Result` を捨てる（`amount(1);`）                                                     | 止まらない。どの library でも通った                                                                                                                                                                                                                                                                             | なし（Oxlint に該当する組み込みの規則がない）                                                                                  |
| `await` した `Result` を使わずに捨てる（`await a();`）                                       | 止まらない                                                                                                                                                                                                                                                                                                      | なし                                                                                                                           |
| `throw "x"`                                                                                  | `only-throw-error` が `Error` 以外を止める。`throw new Error()` は止まらない                                                                                                                                                                                                                                    | [typescript-eslint: only-throw-error](https://typescript-eslint.io/rules/only-throw-error/)                                    |
| ドメインのファイルでの `throw` を禁止                                                        | `no-restricted-syntax` は Oxlint にない（`Rule 'no-restricted-syntax' not found in plugin 'eslint'`）。自作の JS plugin で止められた（`ThrowStatement` を見る 5 行の規則）                                                                                                                                      | [Oxlint: JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)、ADR 0019（同じ形の自作 plugin）                  |
| ドメインから infra の import を禁止                                                          | `no-restricted-imports` の `overrides`（ファイルの glob ごと）で可能。ADR 0007 が同じ形を使っている                                                                                                                                                                                                             | `vite.config.ts` の `lint.overrides`                                                                                           |
| `Result` を返す callback の中の `throw` と `try/catch`                                       | `@praha/byethrow-oxlint`（0.12.0）の `no-throw-in-callback`、`no-try-catch-in-callback` が止めた。`no-ambiguous-error-type`（`Result<number, Error>` を止める）も動いた                                                                                                                                         | [byethrow の README](https://github.com/praha-inc/byethrow/blob/main/README.md)                                                |
| neverthrow の `Result` を使う側の強制                                                        | neverthrow の README は `eslint-plugin-neverthrow`（`must-use`）を勧める。npm の最終更新は 2022-05-01。Oxlint の JS plugin は「型情報を使う規則は未対応」（[Oxlint: JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)）なので、型情報が要るこの規則は Oxlint 上で動かせない。動かしてはいない | [neverthrow の README](https://github.com/supermacro/neverthrow#recommended-use-eslint-plugin-neverthrow)                      |
| Effect の `Effect` を捨てる                                                                  | `@effect/language-service`（0.87.5）に `floatingEffect` の診断がある。TypeScript の language service の plugin で、`vp check` や Oxlint とは別の経路。動かしてはいない                                                                                                                                          | [Effect language-service の README](https://github.com/Effect-TS/language-service)                                             |
| 型の厳しさ                                                                                   | 上の全 library のコードが、ADR 0020 の tsconfig（`skipLibCheck: true`）で `tsc` を通った。Effect 4.0.6 は `skipLibCheck: false` で `ReadableStream`、`URL`、`AbortSignal` などが見つからず落ちる。`@types/node` か DOM の lib がある `apps/api` では通ると予想されるが、動かしていない                          | 確かめた                                                                                                                       |

- 判断: 「`Result` を捨てない」を完全に機械で止められる組み合わせは、確かめた範囲にはない。止められるのは、非同期の `Result`（`no-floating-promises`、neverthrow は `checkThenables` が要る）と、`throw` の禁止（自作 plugin）まで。同期の `Result` の捨て忘れは、型検査では止まらず、レビューまたは自作の型情報つきの規則になる。自作の型情報つきの規則は、Oxlint の JS plugin が型情報に未対応なので、今は作れない。
- 判断: 非同期の `Result` を `Promise<Result>`（byethrow、option-t の形）にすると、追加の設定なしで `no-floating-promises` に乗る。クラスの thenable（neverthrow の `ResultAsync`）は `checkThenables` が要る。

## 5. テスト

### 確かめた結果

vitest 5.0.5 と fast-check 4.10.2 で、次の 2 つの性質を書いて通した（`/tmp/fdm/src/prop.test.ts`）。

- 金額の分割（`split(total, n): Result<number[], "TooSmall">`）: 成功なら合計が元の金額に等しく、全部の要素が `Amount` の schema を通る。失敗なら `total < n`。
- 状態の遷移: 任意の submitted の経費を `approve` しても金額が変わらない。入力は `fc.integer().map(n => Expense.parse({...}))`。

- 判断: 値オブジェクトと状態の遷移は、入力の範囲が広く、不変条件（合計、金額、遷移後の状態）が書きやすいので、性質ベースのテストに向く。`Result` はテストの中で `isErr()` か `ok` の分岐で場合分けできる。
- zod の schema から fast-check の arbitrary を作る library: `zod-fast-check` 0.10.1（2023-09 が最終）は zod 3 まで。`@traversable/zod-test` 0.0.28（2025-10）は zod 4 と fast-check 3〜4 に対応する（npm の peerDependencies）。0.0.x なので成熟度は低い。動かしてはいない。Effect Schema は、Effect 側に Arbitrary の仕組みがあるはずだが、確かめていない。
- Issue #30（テストの強さの基準）との関係: `docs/tooling/ci.md` と ADR 0024 に Stryker（変異テスト）の記述があり、`pnpm-workspace.yaml` の catalog に `@stryker-mutator/core` 10.1.1 がある。fast-check は catalog にない。判断: 性質ベースのテストと変異テストの両方が必要かは #30 で決める。
- 出典: [fast-check](https://fast-check.dev/docs/introduction/)、Wlaschin の [Property-based testing](https://fsharpforfunandprofit.com/series/property-based-testing/)。

## 6. 公開の事例とアンチパターン

### 事例

確かめられたものだけを書く。

| 事例                                                                                                                                                   | 種類                         | 備考                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| [p-tul/fDDD](https://github.com/p-tul/fDDD)                                                                                                            | 学習用の見本                 | 2025-10-28 が最終の push、星 0。自作の `Result`、zod、Clean Architecture 風の構成、DI は tsyringe |
| [shi-rudo/ddd-kit-ts](https://github.com/shi-rudo/ddd-kit-ts)                                                                                          | library                      | 2026-10-23 が最終の push、星 2                                                                    |
| [OrahKokos/domain-modeling-made-functional-typescript](https://github.com/OrahKokos/domain-modeling-made-functional-typescript)                        | 書籍の例の移植               | GitHub の API が応答せず、更新日と星は確かめていない                                              |
| [Inato: fp-ts から Effect への移行](https://medium.com/inato/how-we-migrated-our-codebase-from-fp-ts-to-effect-b71acd0c5640)                           | 企業の自社の記事             | 2024 年初めに fp-ts から Effect へ。TypeScript 約 50 万行。fp-ts と共存させながら移した           |
| [14.ai: Effect で AI エージェントの系を作る](https://www.zenml.io/llmops-database/building-reliable-ai-agent-systems-with-effect-typescript-framework) | 講演の要約（第三者のまとめ） | CTO の講演。本番での利用                                                                          |

- 判断: DMMF の流儀を TypeScript に移した「本番で数年動いている」公開の事例は、今回の検索では見つからなかった。確かめられた本番の事例は、fp-ts と Effect を使う企業の記事に偏る。Result だけを使う本番の事例（neverthrow など）は、利用者数（週 220 万 download）から多いと推測されるが、公開の事例は確かめていない。

### アンチパターン

- Wlaschin 自身の 5 つ（[Against Railway-Oriented Programming](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/)）: 診断が要るのに `Result` にする、例外の代わりにする、すぐ止めるべきなのに続ける、外から見えない内部で使う、誰もエラーの種類を気にしないのに詳細な union にする。
- 同記事は「`Result` に stack trace や例外を詰めるな」「例外を `Result` に変えても、一部は必ず漏れる。最上位で例外を処理せよ」とも書く。判断: ドメインで `throw` を禁止しても、`apps/api` の最上位（Hono の `onError`）で例外を受ける設計は残る。
- 確かめた落とし穴: branded 値を `as` で作る（`no-unsafe-type-assertion` で止まる）、zod の `.optional()` の明示的な `undefined`、同期の `Result` の捨て忘れ、neverthrow の `ResultAsync` を `checkThenables` なしで検査する。
- 判断（確かめていない）: `Result` の連鎖が深くなって読めなくなる。`Result` を返す関数の中で、`try/catch` や `throw` を混ぜる（byethrow の plugin が止める）。`unwrap` 系（neverthrow の `_unsafeUnwrap`）を本番のコードで使う（neverthrow の README は「テスト用」と書く）。

## 比較表

| 観点                           | 自作                                          | option-t          | byethrow                           | neverthrow                                             | true-myth                                  | Effect                                       |
| ------------------------------ | --------------------------------------------- | ----------------- | ---------------------------------- | ------------------------------------------------------ | ------------------------------------------ | -------------------------------------------- |
| 最新版（日付）                 | なし                                          | 56.1.2（2026-05） | 0.12.0（2026-06）                  | 8.2.0（2025-02）                                       | 9.4.0（2026-05）                           | 4.0.6（2026-10）。4.0.0 は 2026-10-01        |
| 保守の兆候                     | 自分たち                                      | 活発              | 活発（0.x）                        | リリースが 20 か月ない                                 | 活発                                       | 非常に活発                                   |
| 週間 download                  | なし                                          | 1.4 万            | 1.1 万                             | 221 万                                                 | 41 万                                      | 3,155 万                                     |
| `Result` だけの bundle（gzip） | 124 B                                         | 231 B             | 1.6 KB                             | 2.1 KB                                                 | 755 B                                      | 6.3 KB（runtime 込みで 31 KB）               |
| strict tsconfig で型検査       | 通った                                        | 通った            | 通った                             | 通った                                                 | 通った                                     | 通った（`skipLibCheck: false` では通らない） |
| 非同期の `Result` を捨てる検査 | `Promise<Result>` なら `no-floating-promises` | 同左              | 同左                               | `checkThenables` が要る                                | 同期の `Result` のみ（非同期の型は未検証） | `floatingEffect`（language service、未検証） |
| 同期の `Result` を捨てる検査   | なし                                          | なし              | なし                               | `eslint-plugin-neverthrow`（ESLint 用、2022 年が最後） | なし                                       | `Effect` なら language service               |
| Oxlint 用の plugin             | なし                                          | なし              | `@praha/byethrow-oxlint`           | なし                                                   | なし                                       | なし（`@effect/eslint-plugin` は ESLint 用） |
| 学習の費用（判断）             | 小さい                                        | 中（Rust の語彙） | 中（`Result.pipe`）                | 中（メソッドの連鎖）                                   | 中                                         | 大（`Effect`、`Layer`、`Schema`）            |
| ドメインの型と zod の共有      | 自由                                          | 自由              | 自由（Standard Schema の型を使う） | 自由                                                   | 自由                                       | `Schema` に寄せるなら zod と二重             |

## 決めるべき論点（#220 で）

1. `Result` を使う範囲。ドメインの予期できる失敗だけ（Wlaschin の分け方）か、アプリ全体か。例外を最上位で受ける設計を残すか。
2. `Result` を自作にするか、library にするか。library なら、保守の兆候（neverthrow のリリース停止、byethrow の 0.x、Effect 4 の新しさ）をどう扱うか。
3. Effect を採るか。採るなら `Layer` と `Schema` までか、`Result` だけを使うか。Hono、zod、Kysely（ADR 0025）との二重をどうするか。
4. branded type の作り方。zod の `.brand()` に寄せるか、型述語に寄せるか、自作の smart constructor を `oxlint-disable` つきで 1 か所だけ許すか。ドメインの型が zod に依存してよいか。
5. 非同期の `Result` の形（`Promise<Result>` か thenable か）。`checkThenables` を `vite.config.ts` に足すか。
6. 同期の `Result` の捨て忘れを、検査なし（レビュー）、自作の型情報つきの規則、`Result` を必ず `match` で消費する規約のどれで扱うか。
7. `throw` の禁止の範囲（ドメインのディレクトリだけか）と、自作の Oxlint plugin（ADR 0019 と同じ形）を足すか。
8. 依存の渡し方。関数の引数（ドメインが port の型を宣言する）か、核に依存を持たせずシェルが読み書きするか。Outbox への event の書き込みを、核が返す値にするか。
9. テスト。fast-check を足すか（catalog にない）。変異テスト（Stryker）との役割の分担は #30 で決める。zod から arbitrary を作る library を使うか、手で書くか。
10. サンプル機能（経費精算）の状態と遷移の型。判別可能な union の状態を、どの粒度の module に置くか（「Not yet specified」の DDD の設計の中身と同じ論点）。

## 未確認のこと

- 本番で動く TypeScript の DMMF の事例（Result を使う側）。公開の事例は学習用の見本が中心だった。
- neverthrow の保守の方針。リリースが止まった理由を述べた一次情報が見つからなかった。
- Effect 4 の `Schema` から fast-check の arbitrary を作る方法と、エージェントが Effect 3 と 4 の API を取り違える頻度。
- `@effect/language-service` の `floatingEffect` と `@effect/eslint-plugin` を、このリポジトリの `vp check` の経路で動かせるか。
- `eslint-plugin-neverthrow` の `must-use` が、現在の ESLint 9 と typescript-eslint で動くか。
- Effect 4.0.6 を `apps/api` の tsconfig（`types: ["node"]`）で型検査したときに通るか。
- `@hono/zod-openapi` を使う route で、zod の branded schema が OpenAPI の出力にどう出るか（型は確かめたが、生成された仕様は見ていない）。
- bundle の大きさは `esbuild` で 1 つの処理を測っただけで、実際のドメインのコードの大きさではない。
- ADR 0020 の「`no-floating-promises` は警告で `denyWarnings` により失敗する」は、既定の設定で動くことを `/tmp` で確かめた（`Warning/typescript(no-floating-promises)`）。このリポジトリの `vite.config.ts` の `typedRules` には書かれておらず、既定の `correctness` に依存している。
- docs/ に DDD、`Result`、値オブジェクトの規約はなかった（`docs/` を `Result<`、`neverthrow`、`値オブジェクト`、`集約` で検索したが、DDD の設計を決めた文書はなかった）。取り込んだガイドラインとの食い違いはない。

## 出典

- Wlaschin: [Domain Modeling Made Functional](https://pragprog.com/titles/swdddf/domain-modeling-made-functional/)、[講演の資料](https://fsharpforfunandprofit.com/ddd/)、[Making illegal states unrepresentable](https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/)、[Railway Oriented Programming](https://fsharpforfunandprofit.com/rop/)、[Against Railway-Oriented Programming](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/)、[Six approaches to dependency injection](https://fsharpforfunandprofit.com/posts/dependencies/)
- Bernhardt: [Boundaries](https://destroyallsoftware.com/talks/boundaries)。[Google Testing Blog: Functional Core, Imperative Shell](https://testing.googleblog.com/2025/10/simplify-your-code-functional-core.html)
- TypeScript: [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)、[TSConfig: exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig/#exactOptionalPropertyTypes)
- zod と API: [Zod](https://zod.dev/api)、[Standard Schema](https://standardschema.dev/)、[@hono/zod-openapi](https://www.npmjs.com/package/@hono/zod-openapi)
- Result の library: [neverthrow](https://github.com/supermacro/neverthrow)、[byethrow](https://praha-inc.github.io/byethrow/)、[option-t](https://github.com/option-t/option-t)、[true-myth](https://github.com/true-myth/true-myth)、[ts-results-es](https://github.com/lune-climate/ts-results-es)、[Effect](https://github.com/Effect-TS/effect)（[MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)、[Branded Types](https://effect.website/docs/code-style/branded-types/)）、[fp-ts](https://github.com/gcanti/fp-ts)、[@effect/language-service](https://github.com/Effect-TS/language-service)
- 検査: [Oxlint: Type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html)、[Oxlint: JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)、[Oxlint: no-floating-promises](https://oxc.rs/docs/guide/usage/linter/rules/typescript/no-floating-promises.html)、[typescript-eslint: no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/)
- テストとデータ: [fast-check](https://fast-check.dev/docs/introduction/)、[Kysely: Simple transaction](https://kysely.dev/docs/examples/transactions/simple-transaction)、[Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)
- 事例: [p-tul/fDDD](https://github.com/p-tul/fDDD)、[shi-rudo/ddd-kit-ts](https://github.com/shi-rudo/ddd-kit-ts)、[OrahKokos/domain-modeling-made-functional-typescript](https://github.com/OrahKokos/domain-modeling-made-functional-typescript)、[Inato の記事](https://medium.com/inato/how-we-migrated-our-codebase-from-fp-ts-to-effect-b71acd0c5640)、[14.ai の講演の要約](https://www.zenml.io/llmops-database/building-reliable-ai-agent-systems-with-effect-typescript-framework)
- このリポジトリ: ADR 0007、0013、0019、0020、0025、`vite.config.ts`、`pnpm-workspace.yaml`
