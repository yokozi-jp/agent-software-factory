# Hono と TypeScript で Idempotency-Key を実装する標準、ベストプラクティス、アンチパターン

## 問い

[Issue #231](https://github.com/yokozi-jp/agent-software-factory/issues/231) の調査。API の書き込み（POST、PATCH）に `Idempotency-Key` を実装するときの標準、ベストプラクティス、アンチパターンを、一次情報で調べる。結果は [#232 API の書き込みの冪等性（Idempotency-Key）を採るか、どの操作に使い、キーをどこに保存するかを決める](https://github.com/yokozi-jp/agent-software-factory/issues/232) の材料にする。この文書は決定を下さない。

調べた日は 2026-10-26。web の情報は版と日付を添えた。実際に動かして確かめた事実は「実行して確認」と書き、自分の判断は「判断」と書く。AWS の上では何も実行していない。

前提にした制約（リポジトリを読んだ結果）:

- `apps/api/src` は Web 標準の API だけで書く（[ADR 0007](../docs/adr/0007-api-on-node-web-standard-app.md)）。Node.js の組み込みモジュール、`Buffer`、`process` は使えない。
- DB は Aurora PostgreSQL。アクセス層は Kysely、スキーマの正本は dbmate の SQL の migration で、実行時に表を作らない（[ADR 0025](../docs/adr/0025-kysely-and-dbmate-sql-first.md)）。全表に `tenant_id`、`ENABLE` と `FORCE ROW LEVEL SECURITY`、一意キーに `tenant_id` を含める（[ADR 0011](../docs/adr/0011-tenant-id-and-rls-from-the-start.md)）。
- テナントと利用者は Better Auth の Cookie のセッションからだけ取る（[ADR 0022](../docs/adr/0022-better-auth-cookie-bff.md)）。`/api/*` の GET、HEAD、OPTIONS 以外は `Content-Type: application/json` が必須（`apps/api/src/security/csrf.ts`）。
- 実行基盤は ECS on Fargate と Lambda Web Functions の両方（ADR 0013）。インスタンスをまたいで共有できる状態は DB だけ。
- 2026-10-26 の時点で、`apps/api` の依存に Kysely はまだない（`hono`、`better-auth`、`pg`、`@hono/node-server` だけ）。`apps/web` の依存に TanStack Query はない（`@tanstack/react-router`、`react`、`react-dom` だけ）。

## 要約

- 標準: [draft-ietf-httpapi-idempotency-key-header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) の今の版は 08（2026-10-22）で、WG Document のまま、IESG の処理は始まっていない（状態は I-D Exists）。RFC ではない。キーがないと 400、ペイロードが違うと 422、処理中の重複は 409（どれも SHOULD）。値は Structured Field の String（引用符で囲む）。有効期間は resource が決めて公開する（SHOULD）。
- 08 で、完了後の再試行への応答が「前の結果（成功でも失敗でも）を返す」（07）から「利用者の意図どおりに完了したことと矛盾しない応答」に変わった。保存した応答をそのまま返し直すことは、もう求めていない。
- 事実上の標準は揃っていない。保存期間は Stripe v1 が少なくとも 24 時間、Stripe v2 が 30 日、Adyen が 7〜14 日、PayPal の Orders API が 6 時間（最長 72 時間）。5xx は Stripe v1 が保存して返し直し、Stripe v2 と PayPal は再実行するか今の状態を返す。キーの範囲はどれもアカウント単位で、Stripe v2 と PayPal は API（操作）ごと。
- Hono の公式の middleware はない。npm の `hono-idempotency` 0.9.1（個人、MIT、14 stars）は Web 標準だけで書かれているが、PostgreSQL の保存先がなく、キーの記録を業務の更新と別に書くので、処理の途中で落ちると「処理中」が TTL（既定 24 時間）まで残る。`@node-idempotency/*` は Node の `crypto` を import し、ADR 0007 に合わない。
- PostgreSQL では、キーの行を業務の更新と同じトランザクションで `INSERT … ON CONFLICT DO NOTHING` すると、同じキーの2つ目の要求は1つ目のトランザクションの終わりまで待ち、1つ目が commit すれば 0 行、rollback すれば自分が入る（PostgreSQL 17.11 で実行して確認）。「処理中」の印と掃除の仕組みが要らなくなる代わりに、2つ目は 409 ではなく待つ。一意キーに `tenant_id` を含めないと、別のテナントの同じキーで 0 行が返り、行は RLS で見えない（実行して確認）。
- web では、キーは利用者の操作（フォームの送信）ごとに1回だけ採番し、再試行のあいだ同じ値を送る。TanStack Query の mutation の再試行は `mutationFn` を呼び直すので、`mutationFn` の中で採番すると試行ごとに別のキーになる。

## 1. 標準（IETF の draft）

### 版と状態

| 項目   | 内容                                                                                                                                               | 出典                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 今の版 | 08。2026-10-22 に出て、2027-04-25 に期限が切れる。07 は 2025-10-15、00 は 2021-07-01                                                               | [datatracker](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)、datatracker の API（`/api/v1/doc/document/…`、`newrevisiondocevent`）                                      |
| 状態   | WG の文書（WG Document）。IESG の状態は I-D Exists（IESG が処理を始めていない）。Intended status は Standards Track（本文の表紙）                  | 同上                                                                                                                                                                                                   |
| 未解決 | 08 の付録 A は、完了後の再試行の文を「still open for discussion」とする。GitHub に open の issue が 10 件ある（TTL、応答の意味、返し直しの印など） | [draft 08 Appendix A](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-08.txt)、[ietf-wg-httpapi/idempotency の issue](https://github.com/ietf-wg-httpapi/idempotency/issues) |

取り込んだ規約 `docs/web-api/idempotency-and-patch.md` の「2026年10月時点ではDraft 08」は合っている。

### 決まっている振る舞い（08）

| 点                  | 08 の記述                                                                                                                                                                                                                                                          | 節         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 形式                | Item Structured Header Field で、値は String（MUST。[RFC 9651](https://www.rfc-editor.org/rfc/rfc9651) 3.3.3）。例は `Idempotency-Key: "<UUID>"` の形で、UUID を引用符で囲む                                                                                       | 2.1、6     |
| 一意性              | キーは一意で、別のペイロードの要求に使い回してはいけない（MUST NOT）。一意性は resource の持ち主が定める（MUST）。UUID（[RFC 9562](https://www.rfc-editor.org/rfc/rfc9562)）か同じくらいランダムな値を RECOMMENDED                                                 | 2.2        |
| 有効期間            | resource は時間で期限を切ってよい（MAY）。期限の方針を定めて文書に公開する（SHOULD）。公開する仕様に期限を含める（MUST、該当するなら）                                                                                                                             | 2.3、2.5.2 |
| fingerprint         | ペイロードから作る fingerprint をキーと併せて使ってよい（MAY）。作り方は、ペイロード全体のチェックサム、一部の要素のチェックサム、項目ごとの値の比較、要求の digest や署名など                                                                                     | 2.4        |
| 初めての要求        | 普通に処理して応答する（SHOULD）                                                                                                                                                                                                                                   | 2.6        |
| 完了後の再試行      | 「利用者の意図どおりに要求が完了したことと矛盾しない応答」を返す（SHOULD）                                                                                                                                                                                         | 2.6        |
| 処理中の再試行      | resource conflict のエラー（409）を返す（SHOULD）                                                                                                                                                                                                                  | 2.6、2.7   |
| キーがない          | キーを必須とする操作でキーがなければ 400 で、本文に文書へのリンクを入れる（SHOULD）。[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) の Problem Details か `Link: …; rel="describedby"` の例がある                                                              | 2.7        |
| ペイロードが違う    | 同じキーを別のペイロードで使うと 422（SHOULD）                                                                                                                                                                                                                     | 2.7        |
| クライアントの直し  | 409 以外のエラーは、クライアントが要求を直してから再試行する（MUST）。直さなければ resource は失敗させる（MUST）                                                                                                                                                   | 2.7        |
| そのほかの 4xx、5xx | 401、403、429、500、502、503、504 などは、resource の文書に従う（SHOULD）。保存するかどうかは決めていない                                                                                                                                                          | 2.7        |
| セキュリティ        | キーの形式を固定して公開し、処理の前に検証する。キャッシュの検索キーは、クライアントのキーと resource だけが知るクライアントの属性を組み合わせた複合キーにする。キーを検証しないと injection、エントロピーの低いキーを許すと別のクライアントの応答の漏えいが起きる | 5          |

### 07 から 08 で変わったこと

07 の 2.6 は、完了後の再試行に「前に完了した操作の結果を、成功でもエラーでも返す」と書いていた（[draft 07](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.txt)）。08 は「利用者の意図どおりに完了したことと矛盾しない応答」に変え、付録 A で [issue #48](https://github.com/ietf-wg-httpapi/idempotency/issues/48) の提案を採ったとする。保存した応答を1バイトずつ返し直す形（Stripe v1）も、今の状態を返す形（PayPal、Stripe v2）も、08 の文に合う、というのが判断。

### 決まっていないこと

- 返し直した応答の印。Stripe は `Idempotent-Replayed: true` を付けるが、draft には何もない（[issue #46](https://github.com/ietf-wg-httpapi/idempotency/issues/46) が open）。
- 期限の長さ（[issue #49](https://github.com/ietf-wg-httpapi/idempotency/issues/49)、[issue #35](https://github.com/ietf-wg-httpapi/idempotency/issues/35) が open）。
- 422 と 409 がアプリの同じ状態コードの意味とぶつかること（[issue #42](https://github.com/ietf-wg-httpapi/idempotency/issues/42) が open）。このリポジトリの規約は、422 を「入力値が業務処理を行う条件を満たさない」、409 を楽観ロックの競合に使う（`docs/web-api/status-codes.md`、`docs/web-api/exclusive-control.md`）。区別は Problem Details の `type` で行うことになる（判断）。

### 規約との食い違い

`docs/web-api/idempotency-and-patch.md` は、キーが処理済みでペイロードのハッシュが違うと 400 を返すとする。draft は 07 も 08 も 422 で、400 はキーがないときに使う。また規約はキーのカラムだけに一意制約を貼るとするが、draft 5 節は複合キーを勧め、ADR 0011 は一意キーに `tenant_id` を含めることを求める（4 節で実行して確認）。この調査の branch は merge しないので、規約は直していない。#232 で直す範囲を決める。

## 2. 事実上の標準（Stripe、Adyen、PayPal）

| 点                   | Stripe API v1                                                                                                                                       | Stripe API v2                                                                                                | Adyen                                                                                         | PayPal                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| ヘッダー             | `Idempotency-Key`                                                                                                                                   | `Idempotency-Key`。なければ Stripe が UUID を作る                                                            | `idempotency-key`（大文字小文字を区別しない）                                                 | `PayPal-Request-Id`                                                        |
| 対象                 | すべての POST。GET と DELETE には効かない                                                                                                           | すべての POST と DELETE                                                                                      | POST                                                                                          | 一部の API の POST（API ごとに文書を見る）                                 |
| キーの形式           | 255 文字まで。V4 UUID か十分なエントロピーのランダムな文字列を勧める。メールアドレスなどの個人の情報を使わない                                      | UUID を勧める                                                                                                | 64 文字まで。UUID を勧める                                                                    | UUID を勧める（38 バイトの上限に収まる）                                   |
| 保存期間             | 少なくとも 24 時間。それより後は消えることがあり、消えた後は新しい要求になる                                                                        | 30 日                                                                                                        | 最初の送信から 7〜14 日                                                                       | Orders API は 6 時間。Account Manager に頼めば 72 時間まで                 |
| キーの範囲           | アカウント                                                                                                                                          | 同じ API、同じアカウントかサンドボックス                                                                     | company account。リージョンをまたぐと検査されない                                             | 要求ごと、かつ API の呼び出しの種類（authorize と capture など）ごとに一意 |
| ペイロードの違い     | 元の要求の引数と比べ、違えばエラー                                                                                                                  | （文書に記述なし）                                                                                           | （文書に記述なし）                                                                            | （文書に記述なし）                                                         |
| 処理中の重複         | 409。待ってから同じキーと引数で再試行する                                                                                                           | （文書に記述なし）                                                                                           | 422 か 409（エラーコード 704）、または `transient-error: true` の一時的なエラー               | 先の要求を処理し、後の要求は失敗させることがある                           |
| 保存する応答         | endpoint の実行が始まった後の状態コードと本文。500 も保存して返し直す。検証の失敗、同時の要求との競合、レート制限など、実行の前のエラーは保存しない | 成功した操作は繰り返さず、更新した応答を返す。失敗か一部の失敗は、副作用を出さずに再実行して新しい応答を返す | 最初の試行の応答を返す                                                                        | 元の要求ではなく、今の状態を返す                                           |
| 返し直しの印         | `Idempotent-Replayed: true`                                                                                                                         | （文書に記述なし）                                                                                           | 応答の `idempotency-key` ヘッダー                                                             | （文書に記述なし）                                                         |
| 保存先が使えないとき | （文書に記述なし）                                                                                                                                  | （文書に記述なし）                                                                                           | 503（エラーコード 703）を一時的なエラーとして返す。キーを付けずに冪等でない処理に戻してもよい | （文書に記述なし）                                                         |

出典: [Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests)、[Stripe: Low-level error handling](https://docs.stripe.com/error-low-level)、[Stripe: API v2 overview](https://docs.stripe.com/api-v2-overview)、[Adyen: API idempotency](https://docs.adyen.com/development-resources/api-idempotency/)、[PayPal: Idempotency](https://developer.paypal.com/reference/guidelines/idempotency/)、PayPal の Orders v2 の OpenAPI（[paypal-rest-api-specifications の checkout_orders_v2.json](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/checkout_orders_v2.json) の `PayPal-Request-Id` の説明、version 2.32）。どれも 2026-10-26 に読んだ。

読み取れること（判断）:

- 期間は 6 時間から 30 日までばらつき、共通の値はない。draft も値を決めない。
- 5xx の扱いは2つに割れる。Stripe v1 は「実行が始まった後の結果は 500 でも保存する」。Stripe v2 と PayPal は「失敗なら再実行するか、今の状態を返す」。後者は、業務の更新と同じトランザクションでキーを記録する形（4 節）と同じ振る舞いになる。
- どれもキーの範囲をアカウント（このリポジトリではテナント）に閉じる。Adyen は、同じアカウントの別の API 資格情報どうしが応答を読み合わないよう、V4 UUID を要求ごとに作ることを求める。

## 3. Hono の middleware と TypeScript の library

### Hono の公式

- Hono の組み込みの middleware（`hono` 4.13.14 の `src/middleware`）に冪等性のものはない。一覧は basic-auth、bearer-auth、body-limit、cache、combine、compress、context-storage、cors、csrf、etag、ip-restriction、jsx-renderer、jwk、jwt、language、logger、method-not-allowed、method-override、mount、powered-by、pretty-json、request-id、secure-headers、serve-static、timeout、timing、trailing-slash（[honojs/hono の src/middleware](https://github.com/honojs/hono/tree/main/src/middleware)）。
- 公式の第三者の middleware（[honojs/middleware の packages](https://github.com/honojs/middleware/tree/main/packages)）にもない。

### npm の候補

数は npm registry の search API の値（2026-10-26）。

| package                                                                                                              | 版と日付             | 月のダウンロード  | 保存先                                                                          | ADR 0007 に合うか                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [hono-idempotency](https://github.com/paveg/hono-idempotency)                                                        | 0.9.1（2026-07-18）  | 約 4,000          | memory、Redis、Cloudflare KV、D1、Durable Objects。差し替えはインターフェースで | 合う。`crypto.subtle`、`Response`、`Headers` だけを使う（src を読んだ）                                                            |
| [@node-idempotency/core](https://github.com/mahendraHegde/node-idempotency) と storage-adapter-postgres              | 1.1.0（2026-08-09）  | 約 53,000（core） | memory、Redis、PostgreSQL                                                       | 合わない。core が `import { createHash } from "crypto"` と `Buffer` を使う。Hono の plugin はない（express、fastify、nestjs だけ） |
| [@aws-lambda-powertools/idempotency](https://docs.aws.amazon.com/powertools/typescript/latest/features/idempotency/) | 2.36.0（2026-10-06） | 約 425,000        | DynamoDB、Valkey、Redis                                                         | Lambda の handler か関数を包む形で、HTTP の middleware ではない。PostgreSQL の保存先はない                                         |

### hono-idempotency を読んだ結果

src（commit `8f9a70b`、2026-10-13）を読んだ。動かしてはいない。

- 振る舞い: 既定で POST と PATCH に効く。キーがなければ通す（`required: true` で 400）。キーは 256 バイトまで。保存のキーは `<prefix>:<method>:<path>:<key>` で、`cacheKeyPrefix` を設定しないと、テナントをまたいで応答を返し直す危険を `console.warn` で警告する。fingerprint は `method:path:body` の文字列の SHA-256 で、本文の生の文字列から作る。処理中なら 409 と `Retry-After: 1`、ペイロードが違えば 422、エラーは Problem Details。返し直しには `Idempotency-Replayed: true`（Stripe の `Idempotent-Replayed` とは綴りが違う）を付け、`Set-Cookie` は保存しない。
- 2xx 以外の応答と例外は保存せず、記録を消す（コメントは「Stripe pattern」とするが、Stripe v1 は 500 を保存する）。2xx 以外を保存する選択肢は [issue #178](https://github.com/paveg/hono-idempotency/issues/178) で open。
- 記録は、`store.lock()`（処理中の印）、`next()`（handler）、`store.complete()` の順に、業務の更新とは別に書く。handler が commit した後、`complete()` の前に process が落ちると、記録は「処理中」のまま残る。memory と D1 の store は TTL（既定 24 時間）が過ぎた記録を無いものとして扱うので、その間の再試行は 409 になり、TTL の後の再試行は handler をもう一度実行する（src を読んだ判断）。
- ヘッダーの値は生の文字列のまま使い、Structured Field の String として引用符を外さない。draft どおりに `"…"` を送るクライアントと、Stripe のように引用符なしで送るクライアントでは、同じ UUID が別のキーになる。
- D1 の store は、初回に `CREATE TABLE IF NOT EXISTS` を実行する。PostgreSQL の store を自分で書くなら、表は migration に置く（ADR 0025）。
- 保守: MIT、作者は個人、GitHub の stars 14、forks 0、2026-02-20 に作られ、最後の push は 2026-10-22（GitHub API、2026-10-26）。1.0 は出ていない。

### Hono で自前に書くときに使える部品

- `c.req.text()` などの本文は `bodyCache` に残るので、middleware で本文を読んでハッシュを取った後も、handler の `c.req.json()` や validator がもう一度読める（`hono` 4.13.14 の [src/request.ts](https://github.com/honojs/hono/blob/v4.13.14/src/request.ts) の `#cachedBody`）。`c.req.raw` を直接読むと残らない。Better Auth の handler は `c.req.raw` を受け取るので、`/api/auth/*` には冪等性の middleware を掛けない（判断）。
- ハッシュは Web Crypto の `crypto.subtle.digest("SHA-256", …)` で取れる。Node.js 24 ではグローバルにあり、ADR 0007 に合う。
- ヘッダーを Structured Field として読むなら、npm の [structured-headers](https://github.com/evert/structured-header) 2.1.1（依存なし）がある。Hono 自身は Structured Field の parser を持たない（`src/utils` を見た）。

## 4. PostgreSQL での保存

### 一意制約と同時の要求（PostgreSQL の仕様）

- 一意索引に、まだ commit していない別のトランザクションが同じ値を入れていると、後から入れる側はそのトランザクションの終わりを待つ。rollback なら衝突しない。commit なら一意制約の違反になる（[PostgreSQL 18: 63.5 Index Uniqueness Checks](https://www.postgresql.org/docs/current/index-unique-checks.html)）。
- `ON CONFLICT DO NOTHING` は、違反の代わりに挿入しない。Read Committed では、`INSERT` の snapshot から見えない別のトランザクションの結果で挿入しないことがある（[INSERT](https://www.postgresql.org/docs/current/sql-insert.html)、[13.2 Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)）。
- 一意制約と外部キーの検査は RLS を迂回する（[5.9 Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)、ADR 0011）。

### 実行して確認したこと

PostgreSQL 17.11（`postgres:17` のコンテナ）で、ADR 0011 の形（`ENABLE` と `FORCE ROW LEVEL SECURITY`、`tenant_id = current_setting('app.current_tenant')::uuid` のポリシー、所有者でないアプリ用のロール）の表を作り、psql の2つのセッションで流した。表は `PRIMARY KEY (tenant_id, user_id, idempotency_key)` の `idempotency_keys` と、業務の表 `claims`。要求 A は、1つのトランザクションでキーの行と `claims` の行を入れ、3 秒待ってから応答を書く。要求 B は、0.5 秒後に同じキーで `INSERT … ON CONFLICT DO NOTHING RETURNING …` を実行する。

| 場合                                                                                  | 結果                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A が COMMIT                                                                           | B の `INSERT` は約 3 秒待って `INSERT 0 0`。続く `SELECT` で A の応答（201 と本文）が見えた。`claims` は 1 行                                           |
| A が ROLLBACK                                                                         | B は約 3 秒待って自分の行を入れた（`INSERT 0 1`）。`claims` は 0 行（A の業務の行も消えた）                                                             |
| B に `SET LOCAL lock_timeout = '1s'`                                                  | B は 1 秒で `canceling statement due to lock timeout`（`while inserting index tuple`）で失敗した                                                        |
| 一意キーが `idempotency_key` だけ（`tenant_id` を含めない）で、別のテナントが同じキー | テナント 2 の `ON CONFLICT DO NOTHING` は `INSERT 0 0`、続く `SELECT` は 0 行（テナント 1 の行は RLS で見えない）。`ON CONFLICT` なしなら一意制約の違反 |
| 一意キーに `tenant_id` を含める                                                       | テナント 2 は同じキーで自分の行を入れられた                                                                                                             |

読み取れること:

- キーの行を業務の更新と同じトランザクションに入れると、業務の結果とキーの記録が一緒に commit か rollback される。commit の後に落ちても応答は残り、commit の前に落ちれば両方が消える。「処理中」のまま残る記録がないので、処理中の印の期限と、その後の再実行による二重の処理が起きない。
- その代わり、処理中の2つ目の要求は 409 にならず、1つ目のトランザクションが終わるまで待つ。待つ間、接続を1本使う。`lock_timeout` で待ちを切れば、そのエラー（SQLSTATE `55P03` lock_not_available。[Appendix A](https://www.postgresql.org/docs/current/errcodes-appendix.html)）を 409 と `Retry-After` に変えられる（判断）。待たずに 409 を返したいなら、`INSERT` の前に `pg_try_advisory_xact_lock(…)` を取る形がある（[9.28.10 Advisory Lock Functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)。この形は動かしていない）。
- 一意キーに `tenant_id` を含めないと、別のテナントが同じキーを使ったとき、行は無いのに挿入されない状態になり、別のテナントにそのキーがあることも分かってしまう。ADR 0011 の規則と draft 5 節の複合キーの両方が、`tenant_id`（と利用者）を含めることを求める。

### 書き方の候補

| 形                                                        | 内容                                                                                                                                                                                                                                                                 | 向く操作と弱い点                                                                                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 同じトランザクション                                   | `BEGIN`、`set_config('app.current_tenant', …, true)`、キーの行を `ON CONFLICT DO NOTHING RETURNING`、0 行なら既存の行を読んでハッシュを比べ、違えば 422、同じなら保存した応答（か今の状態）を返す。1 行なら業務の更新をし、同じ行に状態コードと本文を書いて `COMMIT` | DB の中で完結する操作に向く。外への副作用（メール、S3、外部の POST）はトランザクションに入らないので、Outbox に書いて同じトランザクションで commit する（ADR 0011、ADR 0013 の Outbox）。2つ目は待つ |
| B. 処理中の印を別のトランザクションで書く（library の形） | キーの行を「処理中」で先に commit し、handler の後に応答を書く。落ちたときのために、印に期限か `locked_at` を持たせ、古い印を引き継ぐ                                                                                                                                | DB の外の副作用を途中の段階として記録したいときに向く。印の期限、引き継ぎ、二重の実行の扱いを自分で書く                                                                                              |
| C. 業務の表に要求の ID の一意制約を付ける                 | 取り込んだ規約の TIP の形。業務の行（申請など）に `idempotency_key` と `request_hash` のカラムを持たせ、`(tenant_id, idempotency_key)` に一意制約を貼る                                                                                                              | 作成（POST）で行が1つできる操作に向く。応答を保存しないので、再試行には今の行から応答を作る（PayPal、Stripe v2 と同じ）。PATCH や、行が複数できる操作には合わない                                    |

### Kysely と RLS の下での書き方

Kysely 0.29.7 の API で書ける部品（コードは書いたが、Kysely は `apps/api` にまだなく、動かしていない）:

- トランザクションは `db.transaction().execute(async (trx) => …)`。テナントは、その中で ``sql`select set_config('app.current_tenant', ${tenantId}, true)`.execute(trx)`` で設定する（ADR 0011 の `SET LOCAL` と同じ。値は bind 変数にする、ADR 0025）。
- キーの行は `trx.insertInto("idempotency_keys").values({ … }).onConflict((oc) => oc.columns(["tenant_id", "user_id", "idempotency_key"]).doNothing()).returning(["idempotency_key"]).executeTakeFirst()`（[kysely の insert-query-builder.ts の onConflict](https://github.com/kysely-org/kysely/blob/master/src/query-builder/insert-query-builder.ts)）。
- `lock_timeout` は、同じトランザクションの先頭で `` sql`set local lock_timeout = '…'` `` にする。
- 表、一意制約、RLS、`FORCE`、`GRANT`、期限の索引は migration に書く（ADR 0025）。型は kysely-codegen でスキーマごとに生成するので、キーの表はそれを使うモジュールのスキーマに置くか、共通のスキーマに置くかを決めることになる（判断）。

### 期限切れの掃除

- 期限を過ぎた行は、検索で無いものとして扱い（`created_at > now() - interval '…'`）、別に消す。
- 消すのはバッチで、ADR 0011 のとおりテナントをパラメータに取り、`BYPASSRLS` のロールで全テナントを一度に消さない。`(tenant_id, created_at)` の索引があれば範囲で消せる（判断）。
- 行が多いなら、`created_at` の範囲で表をパーティションに分け、古いパーティションを `DROP` する形もある。PostgreSQL の文書は、パーティションの追加と削除で大量の削除を行うと `VACUUM` の負荷を避けられるとする（[5.12 Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)）。経費精算の量では要らない、というのが判断。
- 応答の本文を保存するなら、本文の個人の情報も期限まで残る。Stripe はキーに個人の情報を使わないよう求める（2 節）。保存期間はログの保存期間と揃えて決める（判断）。

## 5. アンチパターン

| アンチパターン                                                   | 何が起きるか                                                                                                                                                                                                                                                                                       | 出典                                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 確かめてから挿入する（`SELECT` してから `INSERT`）               | 2つの要求が両方とも「無い」と読み、両方が処理する。一意制約があれば後の `INSERT` が違反で失敗するが、業務の更新を先にしていれば二重に処理した後になる。一意制約と `ON CONFLICT` に任せる                                                                                                           | [INSERT の ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)、[63.5](https://www.postgresql.org/docs/current/index-unique-checks.html) |
| ペイロードのハッシュを持たない                                   | 同じキーを別の内容で送った要求に、前の応答を返す。利用者は別の申請をしたつもりで、何も起きない。draft は 422、Stripe はエラーにする                                                                                                                                                                | draft 08 2.2、2.7、[Stripe](https://docs.stripe.com/api/idempotent_requests)                                                                               |
| 本文の生の文字列をハッシュにして、空白や順序の違いで不一致にする | hono-idempotency は生の文字列を使う。同じクライアントが同じバイト列を送り直すなら問題にならないが、再試行のたびに JSON を作り直すと 422 になりうる（判断）。項目ごとに比べるか、正規化（[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)）してからハッシュにする方法がある（draft 2.4 の選択肢） | draft 08 2.4、hono-idempotency の `fingerprint.ts`                                                                                                         |
| 5xx や途中の失敗を、処理が始まる前のものまで保存する             | Stripe v1 でも、検証の失敗、同時の要求との競合、レート制限は保存しない。保存すると、直した後の再試行が古いエラーを受け取る。draft は 409 以外はクライアントが直してから再試行するとする                                                                                                            | [Stripe](https://docs.stripe.com/error-low-level)、draft 08 2.7                                                                                            |
| 「処理中」の印を業務と別に書き、落ちたときの扱いがない           | 印が期限まで残り、その間 409、期限の後に再実行する（3 節）。Powertools は Lambda の残り時間で処理中の期限（`inProgressExpiryTimestamp`）を切る                                                                                                                                                     | hono-idempotency の src、[Powertools](https://docs.aws.amazon.com/powertools/typescript/latest/features/idempotency/)                                      |
| serverless や複数のインスタンスでメモリに置く                    | Lambda Web Functions は複数の実行環境で並行して動き、使われないと実行環境を消す（scale to zero）。ECS もタスクが複数ある。メモリの記録は別の実行環境から見えず、消えると忘れる                                                                                                                     | [Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)                                                                    |
| キーをテナントと利用者で分けない                                 | 別のテナントや利用者の応答を返し直すか（library の形）、挿入されないのに行が見えない（RLS の形。4 節で実行して確認）。draft は複合キー、Adyen は資格情報どうしの読み合いを警告する                                                                                                                 | draft 08 5 節、[Adyen](https://docs.adyen.com/development-resources/api-idempotency/)、ADR 0011                                                            |
| キーを検証しない、エントロピーの低いキーを許す                   | injection と、別のクライアントのキーの推測による漏えい。形式を固定して公開し、処理の前に検証する                                                                                                                                                                                                   | draft 08 5 節                                                                                                                                              |
| 返し直す応答に `Set-Cookie` を含める                             | 別の要求のセッションの Cookie を配りうる。hono-idempotency は `set-cookie` を保存しない                                                                                                                                                                                                            | hono-idempotency の `middleware.ts`                                                                                                                        |
| 新しいキーで再試行する                                           | 結果の分からない要求を新しいキーで送ると、別の操作として二重に処理される。Stripe は、500 や接続の失敗の後は、結果が分かるまで新しいキーで再試行しないよう求める                                                                                                                                    | [Stripe](https://docs.stripe.com/error-low-level)                                                                                                          |

## 6. web（React）の側

- 採番: `crypto.randomUUID()` で V4 UUID を作れる。2022-03 から主要なブラウザで使え、secure context（HTTPS）でだけ使える（[MDN: Crypto.randomUUID()](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)）。ローカルの `http://localhost` も secure context として扱われる（[MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)）。
- 採番の時期: キーは「利用者の1回の操作」に1つ。フォームを開いたときか、送信のボタンを押したときに作り、その操作の再試行のあいだ同じ値を送る。成功した後、または利用者が内容を直した後（422 の後）は新しいキーにする。draft は、キーを別のペイロードに使い回さない（MUST NOT）、409 以外はクライアントが直してから再試行するとする（draft 08 2.2、2.7）。Stripe は、SDK の呼び出しや process の再起動をまたいで再試行するなら、キーを作って永続化し、すべての試行に同じキーを渡すよう求める（[Stripe](https://docs.stripe.com/error-low-level)）。
- TanStack Query を使う場合: mutation は既定で再試行しないが、`retry` で再試行できる。オフラインで失敗した mutation は、再接続のときに同じ順で再試行する。同じ `mutate` を何度呼んでも既定では並行に走り、`scope.id` を付けると直列になる（[TanStack Query: Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)）。再試行は `mutationFn` を同じ変数で呼び直すので、キーは `mutationFn` の中で作らず、変数に入れて渡す（判断）。
- ボタンの連打: 1回目の送信の間はボタンを押せなくするのが基本で、キーはそれでも起きる重複（タイムアウトの後の再送、二重のクリックのすり抜け）の最後の守りになる（判断）。
- 送り方: 同じオリジンの `/api/*` なので、`Idempotency-Key` を足しても CORS の preflight は起きない。ヘッダーの値は、draft に従えば `"<uuid>"` と引用符で囲む。

## 7. 規約にない操作の性質（PATCH と楽観ロック）

PATCH は JSON Merge Patch（RFC 7396）で、同じ patch を2回当てても結果は同じになることが多い。ただし、このリポジトリはバージョン番号の楽観ロックで競合を 409 にする（`docs/web-api/exclusive-control.md`）。1回目が成功して応答を失い、同じ要求（同じバージョン番号）を再試行すると、2回目はバージョンが進んでいるので 409 になる。利用者から見ると、成功した更新が失敗に見える。キーで1回目の結果を返し直すと、これを避けられる（判断）。PUT と DELETE は RFC 9110 で冪等で（draft 08 1 節）、draft の対象は POST と PATCH。Stripe v1 も POST だけを対象にし、Stripe v2 は DELETE も対象にする（2 節）。

## 決定への材料

[#232](https://github.com/yokozi-jp/agent-software-factory/issues/232) で決めることと、その選択肢。どれを選ぶかは #232 で決める。

### 採るか、どの操作に使うか

| 選択肢                                                     | 利点                                                            | 費用                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 申請の作成など、二重になると困る POST だけに必須にする     | 範囲が小さい。キーがなければ 400 にでき、付け忘れが分かる       | 対象の操作の一覧を文書に公開し続ける（draft 2.5.2 の MUST）                                |
| POST と PATCH のすべてに必須にする（取り込んだ規約のまま） | 例外がない。PATCH の楽観ロックの誤った 409 も避けられる（7 節） | すべての書き込みの経路にキーの表への書き込みが増える。web のすべての mutation がキーを持つ |
| 任意にする（あれば効かせる）                               | web の対応が遅れても動く                                        | 付け忘れが見えない。draft の「必須ならキーがないと 400」が使えない                         |
| 採らず、業務の一意キー（C の形）で作成の重複だけを防ぐ     | 部品が増えない                                                  | PATCH と、行が複数できる操作は守れない                                                     |

### キーをどこに保存し、どう書くか

| 選択肢                                                             | 利点                                                                                               | 費用                                                                                                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A. PostgreSQL の専用の表に、業務と同じトランザクションで書く       | 落ちても「処理中」が残らない（4 節で実行して確認）。ECS と Lambda で共有できる。RLS がそのまま効く | 2つ目の要求は待つ（409 にするなら `lock_timeout` か advisory lock）。外への副作用は Outbox に寄せる。handler がトランザクションを持つ形になる |
| B. PostgreSQL の専用の表に、処理中の印を別のトランザクションで書く | middleware で handler を包める。処理中は 409 をすぐ返せる                                          | 落ちたときの印の期限と引き継ぎを書き、その後の二重の実行を許すか決める                                                                        |
| C. 業務の表にキーとハッシュのカラムを持たせる                      | 表が増えない。作成の重複を DB の制約で止める                                                       | 応答を保存しないので、返し直しは今の行から作る。PATCH に合わない                                                                              |
| hono-idempotency に PostgreSQL の store を足して使う               | 409、422、Problem Details、返し直しの印を書かずに済む。Web 標準だけで書かれている                  | B の弱点をそのまま持つ。0.x で個人の保守。引用符付きのキー、2xx 以外を保存しないこと、ヘッダー名が library の都合で決まる                     |
| Redis や DynamoDB を足す                                           | 速い。Powertools が DynamoDB を持つ                                                                | 今の構成にない基盤が増え、業務の更新と同じトランザクションにできない                                                                          |

### そのほかに決めること

- キーの範囲: `(tenant_id, user_id, key)` か、操作（method と経路）まで含めるか。Stripe v2 と PayPal は操作ごと。
- 期限: 6 時間から 30 日まで例がある。web の再試行と、利用者が画面を開いたまま再送するまでの時間で決める。期限を文書に公開する（draft 2.3、2.5.2）。
- 完了後の再試行に返すもの: 保存した状態コードと本文をそのまま返すか（Stripe v1）、今の状態を返すか（PayPal、Stripe v2）。返し直しの印（`Idempotent-Replayed` か `Idempotency-Replayed` か、付けないか）。
- 保存する応答: 2xx だけか、業務の 4xx（422）も含めるか。A の形では、rollback した失敗は自然に残らない。
- ペイロードの比較: 本文のバイト列のハッシュか、検証した後の値を正規化したハッシュか。
- ヘッダーの形式: draft どおり引用符付きの String を求めるか、引用符なしも受けるか。キーの形式（UUID だけか）と長さの上限。
- 規約の直し: `docs/web-api/idempotency-and-patch.md` の「ペイロードが違えば 400」を draft の 422 に、「キーのカラムだけに一意制約」をテナントと利用者を含む複合キーに直すか。422 を業務の入力の誤りと区別する Problem Details の `type`。

## まだ確かめていないこと

- Kysely のコードは書いただけで、動かしていない（Kysely は `apps/api` にまだない）。
- advisory lock で待たずに 409 を返す形は、動かしていない。
- hono-idempotency は src を読んだだけで、動かしていない。「処理中」が残る振る舞いは、src から読み取った判断。
- Aurora PostgreSQL の上では何も動かしていない。実験は PostgreSQL 17.11 のコンテナで行った。
- Stripe v2 のペイロードの比較、Adyen と PayPal のペイロードの違いの扱いは、文書に記述が見つからなかった。
