---
type: ADR
title: "ADR 0036: POST と PATCH のすべてに Idempotency-Key を必須にし、キーはモジュールのスキーマの専用の表に業務の更新と同じトランザクションで書く"
description: API の書き込みの二重送信を防ぐ Idempotency-Key の決定。対象は POST と PATCH のすべてで、キーがなければ 400。キーはモジュールごとのスキーマの専用の表に、業務の更新と同じトランザクションで書き、一意キーは (tenant_id, user_id, idempotency_key)、行に request_hash（method、経路、クエリ文字列、本文のバイト列の SHA-256）、状態コード、本文、expires_at を持つ。ヘッダーは引用符付きの String で値は UUID。処理中の重複は lock_timeout 5 秒で待たせて切れたら 409 と Retry-After、ハッシュが違えば 400、保存期間は 24 時間、保存は 2xx だけで再試行には保存した状態コードと本文をそのまま返す。実装は packages/shared の関数を各モジュールの application の層が呼び、Hono の middleware にはしない。取り込んだ規約との違いは一意キーに tenant_id と user_id を足す 1 点。比べた案は、library（hono-idempotency）、処理中の印を別のトランザクションで書く形、業務の表のカラム、Redis と DynamoDB、任意のヘッダー、advisory lock。API の書き込みを足すとき、POST か PATCH の route を書くとき、冪等キーの表や共有の関数を書くとき、再試行のしくみを足すとき、library や Redis で冪等性を済ませたくなったとき、Hono の middleware にしたくなったときに読む。
tags: [adr, web-api, idempotency, db, postgresql, rls, hono, modules]
---

# ADR 0036: POST と PATCH のすべてに Idempotency-Key を必須にし、キーはモジュールのスキーマの専用の表に業務の更新と同じトランザクションで書く

ボタンの連打やタイムアウトの後の再送で、申請の提出や承認が二重に実行されないように、`Idempotency-Key` を採ります。取り込んだ規約 ([Web API の冪等性と PATCH の部分更新](../web-api/idempotency-and-patch.md)) に沿い、[ADR 0011](0011-tenant-id-and-rls-from-the-start.md) と衝突する一意キーの 1 点だけを直します。決定は [Issue #232](https://github.com/yokozi-jp/agent-software-factory/issues/232)、調査は [Issue #231](https://github.com/yokozi-jp/agent-software-factory/issues/231) にあります。表と共有の関数は [Issue #323](https://github.com/yokozi-jp/agent-software-factory/issues/323)、契約のゲートと web の hook は [Issue #324](https://github.com/yokozi-jp/agent-software-factory/issues/324)、期限切れの掃除は [Issue #325](https://github.com/yokozi-jp/agent-software-factory/issues/325) で実装します。

## ルール

- **対象**: POST と PATCH のすべての route に `Idempotency-Key` を必須にします。キーがなければ 400 です。例外の一覧は持ちません。PATCH は、バージョン番号の楽観ロック ([排他制御](../web-api/exclusive-control.md)) の下で、成功して応答を失った要求を再試行すると 2 回目が 409 になります。キーで 1 回目の結果を返し直すと避けられます (判断)。`/api/auth/*` (Better Auth) は契約の外にあり ([ADR 0022](0022-better-auth-cookie-bff.md))、対象にしません。
- **ヘッダーの形式**: [IETF の draft 08](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08) の Structured Field の String、つまり引用符付き (`Idempotency-Key: "<UUID>"`) だけを受けます。値は UUID に限ります。形式の違反は 400 で、処理の前に検証します。web は `crypto.randomUUID()` で、利用者の 1 回の操作ごとに採番します。
- **保存先**: モジュールごとのスキーマの専用の表 `idempotency_key` に、業務の更新と同じトランザクションで書きます。業務の結果とキーの記録は、一緒に commit されるか、一緒に rollback されます。
- **一意キーと行**: 主キーは `(tenant_id, user_id, idempotency_key)` です。行に `request_hash`、状態コード、本文、`expires_at` を持ちます。表は [ADR 0011](0011-tenant-id-and-rls-from-the-start.md) のとおり `ENABLE` と `FORCE ROW LEVEL SECURITY` を付け、`app.current_tenant` で比べるポリシーを置きます。
- **ペイロードの比較**: `request_hash` は、method、経路、クエリ文字列、本文のバイト列の SHA-256 です。同じキーでハッシュが違えば 400 です。JSON は正規化しません。draft の 422 は使わず、`type` で区別します (「標準との違い」)。
- **処理中の重複**: 待たせます。同じキーの 2 つ目の要求は、1 つ目のトランザクションの終わりまで、キーの `INSERT` の中で待ちます。待ちを `SET LOCAL lock_timeout = '5s'` で切り、切れたら (`55P03`) 409 と `Retry-After` を返します。`lock_timeout` は `INSERT` の文にだけ効かせ、`INSERT` の直後に `SET LOCAL lock_timeout = 0` で戻します。戻さないと、同じトランザクションの後続の文である業務の `UPDATE` のロック待ちも `55P03` になり、409 に誤って変換します。
- **保存期間**: 24 時間 (`expires_at`)。docs に公開します。期限切れの行の掃除は [Issue #325](https://github.com/yokozi-jp/agent-software-factory/issues/325) です。
- **保存する応答**: 2xx だけです。2xx 以外は rollback し、キーの行も残しません。そのため、業務の失敗 (422 など) を直して同じキーで再試行すると、業務の処理をもう一度実行します。
- **再試行への応答**: 完了後の再試行には、保存した状態コードと本文をそのまま返します。返し直しの印 (`Idempotent-Replayed` など) は付けません。ヘッダーは保存しません。
- **実装の場所**: `packages/shared` の関数を、各モジュールの `application` の層が、業務の処理を引数に渡して呼びます ([ADR 0028](0028-effect-in-application-and-infrastructure.md))。Hono の middleware にはしません。業務と同じトランザクションにするには、トランザクションを開く層が呼ぶ必要があるためです。ヘッダーの形式の検査は Hono の層に置きます。
- **外への副作用**: トランザクションに入らないので、Outbox に書いて同じトランザクションで commit します ([ADR 0029](0029-module-data-ownership-and-shared-outbox.md))。
- **対象外**: 非同期のコンシューマーの冪等性 ([ADR 0029](0029-module-data-ownership-and-shared-outbox.md) の `processed_message`、[非同期処理の冪等性](../async/idempotency.md)) は、この ADR の範囲ではありません。

## ADR 0011 と ADR 0029 との関係

どちらとも衝突しません。

- **ADR 0011**: 一意キーに `tenant_id` を含め、表に RLS を付ける規則に従います。取り込んだ規約の「キーのカラムだけに一意制約」を直すのは、この規則に合わせるためです。`tenant_id` を含めないと、別のテナントの同じキーで、行は RLS で見えないのに挿入だけが拒まれます (PostgreSQL 17 のコンテナで実行して確かめた)。
- **ADR 0029**: 「1 つのトランザクションは 1 つのモジュールの表だけを書く」に従うため、表は共有のスキーマでなくモジュールごとのスキーマに置きます。共有の表にすると、業務の更新と同じトランザクションに入れるのに、モジュールのロールへ別のスキーマの権限を与えることになります。表の権限は、`<module>_module` のロールに必要なものだけを与えます。

## 標準との違い

- **取り込んだ規約との違いは 1 点**: 一意制約を、キーのカラムだけから `(tenant_id, user_id, idempotency_key)` にします。対象の操作 (POST と PATCH)、ペイロードのハッシュ、不一致は 400、UUID の採番は、規約のままです。規約が決めていない保存先、ヘッダーの形式、保存期間は、この ADR で足します。
- **ペイロードが違うときは 422 でなく 400**: draft 08 は 422 (SHOULD) です。取り込んだ規約は 400 で、このリポジトリの 422 は「入力値が業務処理を行う条件を満たさない」に使います ([ステータスコード](../web-api/status-codes.md))。draft は RFC ではなく WG の文書のままで、422 とアプリの意味のぶつかりは draft 側でも未解決です ([ietf-wg-httpapi/idempotency#42](https://github.com/ietf-wg-httpapi/idempotency/issues/42))。そこで規約の 400 を残し、Problem Details の `type` で、キーなし、形式の違反、ペイロードの不一致、処理中を区別します (形は [ADR 0035](0035-problem-details-for-api-errors.md) に揃えます。`type` の名前は実装の Issue で決めます)。
- **処理中は 409 を返し、待たせる**: draft は、元の要求が処理中のときの再試行に 409 を返す (SHOULD) としています。この ADR は、まず待たせ、`lock_timeout` が切れたときだけ 409 にします。待つのは、キーの行が業務の更新と同じトランザクションにあり、PostgreSQL の一意索引が、commit していない別のトランザクションの同じ値を待つ仕様のためです ([63.5 Index Uniqueness Checks](https://www.postgresql.org/docs/current/index-unique-checks.html))。1 つ目が commit すれば 2 つ目の `INSERT` は 0 行になり、保存した応答を読みます。rollback すれば 2 つ目が自分で入ります。
- **保存期間は 24 時間**: draft は期限を resource が定めて公開する (SHOULD) とだけ書き、長さは決めていません。事実上の標準も揃っていません (Stripe v1 は少なくとも 24 時間、Stripe v2 は 30 日、Adyen は 7〜14 日、PayPal の Orders API は 6 時間)。24 時間は Stripe v1 に合わせた判断です。
- **返し直しの印を付けない**: Stripe v1 は `Idempotent-Replayed: true` を付けます。draft には印の定めがなく、議論は未解決です ([ietf-wg-httpapi/idempotency#46](https://github.com/ietf-wg-httpapi/idempotency/issues/46))。
- **2xx だけを保存する**: Stripe v1 は、実行が始まった後の 500 も保存して返し直します。Stripe v2 と PayPal は、失敗なら再実行するか今の状態を返します。業務の更新と同じトランザクションに記録するこの形は、後者と同じ振る舞いです。
- **避けるアンチパターン**: 確かめてから挿入すること (2 つの要求が両方「無い」と読む)。ペイロードのハッシュを持たないこと。処理の前のエラーまで保存すること。処理中の印を業務と別に書き、落ちたときの扱いがないこと。複数のインスタンスでメモリに置くこと。キーをテナントと利用者で分けないこと。結果の分からない要求を新しいキーで再試行すること。

## 検査

| 規則                                                                                                                                      | 止める仕組み                                                                                                                                                                      | 動く場所                | 実装                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| すべての POST と PATCH の operation が `Idempotency-Key` を必須にする                                                                     | 契約のゲート (Spectral の規則か oasdiff)。`/api/auth/*` は契約の外なので対象外                                                                                                    | CI                      | [Issue #324](https://github.com/yokozi-jp/agent-software-factory/issues/324) |
| 書き込みの use case が共有の関数を通る                                                                                                    | Oxlint の `no-restricted-imports` か、カタログのテスト                                                                                                                            | `vp check` か結合テスト | [Issue #324](https://github.com/yokozi-jp/agent-software-factory/issues/324) |
| 共有の関数の振る舞い (並行、落ちた後の再試行、rollback、`lock_timeout`、テナントと利用者の分離、ペイロードの不一致、2xx 以外を保存しない) | 実際の PostgreSQL に対する結合テスト。公開の境界は共有の関数                                                                                                                      | 結合テスト              | [Issue #323](https://github.com/yokozi-jp/agent-software-factory/issues/323) |
| 表の RLS とロールの権限                                                                                                                   | カタログのテスト (`pg_policies` など。[ADR 0011](0011-tenant-id-and-rls-from-the-start.md)、[ADR 0029](0029-module-data-ownership-and-shared-outbox.md) のカタログのテストに足す) | 結合テスト              | [Issue #323](https://github.com/yokozi-jp/agent-software-factory/issues/323) |
| web が操作ごとにキーを採り、再試行のあいだ同じ値を送る                                                                                    | 単体テスト (hook)                                                                                                                                                                 | `vp test`               | [Issue #324](https://github.com/yokozi-jp/agent-software-factory/issues/324) |
| 期限切れの行の掃除                                                                                                                        | 実際の PostgreSQL に対する結合テスト                                                                                                                                              | 結合テスト              | [Issue #325](https://github.com/yokozi-jp/agent-software-factory/issues/325) |

[保証カタログ](../tooling/assurance-catalog.md) には、「冪等キー」の行を足します。検査の実装がそろうまで、行は「これから足す行」の節に置き、ゲートは「なし」です。

web が使う `crypto.randomUUID()` は secure context (HTTPS) でしか使えません。`http://localhost` は使えますが、それ以外の HTTP では動きません。web が再試行のあいだ同じキーを保つ書き方 (キーは `mutationFn` の外で作って変数に入れる) は、Issue #324 の hook に置きます。

## Considered Options

- **採らず、楽観ロックと状態遷移の検査で足りるとする**: 部品は増えません。ただし、成功して応答を失った PATCH の再試行は、バージョン番号が進んでいるので 409 になり、成功した更新が失敗に見えます。行が 1 つできる作成も、状態遷移の検査では重複を止められません。
- **一部の POST にだけ必須にする、またはヘッダーを任意にする**: 範囲は小さくなります。ただし、対象の操作の一覧を公開し続ける必要があります (draft 2.5.2)。任意にすると、付け忘れが見えず、「キーがなければ 400」が使えません。
- **library (hono-idempotency) を使う**: 409、Problem Details、返し直しの印を書かずに済み、Web 標準の API だけで書かれているので [ADR 0007](0007-api-on-node-web-standard-app.md) に合います。ただし、0.9.1 は PostgreSQL の store がなく、処理中の印を業務の更新と別に書くので、落ちると期限 (既定 24 時間) まで 409 になり、期限の後に二重に実行します。ヘッダーの引用符も外しません。0.x で、保守は個人です (どれも Issue #231 で src を読んだ判断。動かしていない)。
- **処理中の印を別のトランザクションで書く**: middleware で handler を包めて、処理中の 409 をすぐ返せます。ただし、落ちたときの印の期限、引き継ぎ、その後の二重の実行を自分で書くことになります。
- **業務の表にキーとハッシュのカラムを持たせる** (取り込んだ規約の TIP の形): 表が増えません。ただし、応答を保存しないので返し直しは今の行から作ることになり、PATCH と、行が複数できる操作には合いません。
- **Redis や DynamoDB に置く**: 速くなります。ただし、今の構成にない基盤が増え、業務の更新と同じトランザクションにできません。API は ECS と Lambda の両方で動き ([ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md))、インスタンスをまたいで状態を共有できるのは今は DB だけです ([Issue #231](https://github.com/yokozi-jp/agent-software-factory/issues/231) の前提)。
- **共有のスキーマの 1 つの表にする**: 掃除は 1 か所で済みます。ただし、[ADR 0029](0029-module-data-ownership-and-shared-outbox.md) の「1 つのトランザクションは 1 つのモジュールの表だけ」と、モジュールのロールの分離に反します。
- **advisory lock で待たずに 409 を返す**: 接続を占有しません。ただし、動かして確かめていません。
- **Hono の middleware にする**: route に一律に掛けられます。ただし、業務と同じトランザクションにできません。

## Consequences

- 書き込みの route は、キーの検証と共有の関数への委譲が前提になります。web のすべての mutation は、キーを持って送ります。
- 同じキーの 2 つ目の要求は、最大 5 秒、接続を 1 本使って待ちます。同時の再送が多いと、接続プールを圧迫します (判断)。Lambda から Aurora への接続の数に響く場合は、待たずに 409 を返す形 (advisory lock) を見直します。
- 外への副作用は、Outbox を通さないと二重になります。業務の処理の中で外へ直接呼ばないでください。
- 期限切れで、まだ掃除されていない行の扱いは、この ADR では決めていません (「確かめられなかったこと」)。

## 確かめられなかったこと

- Kysely のコードは書いていません。`apps/api` に Kysely がまだありません。
- Aurora Serverless v2 の上での振る舞いは、確かめていません。`SET LOCAL lock_timeout` と一意索引の待ちは、PostgreSQL 17 のコンテナで確かめました ([Issue #232](https://github.com/yokozi-jp/agent-software-factory/issues/232) の解決コメント)。
- 保存した応答が、デプロイをまたいで古い契約の形になることの扱いは、決めていません。更新の試験 ([Issue #213](https://github.com/yokozi-jp/agent-software-factory/issues/213)) の範囲に入るかも未確認です。
- 期限 (`expires_at`) を過ぎて、まだ消されていない行に当たった要求を、どう扱うかは決めていません。主キーが残っているので、そのままでは `INSERT` が 0 行になり、期限切れの応答を返し直します。無いものとして扱う書き方は、[Issue #323](https://github.com/yokozi-jp/agent-software-factory/issues/323) と [Issue #325](https://github.com/yokozi-jp/agent-software-factory/issues/325) で決めます。
- `Retry-After` の値は決めていません。[Issue #323](https://github.com/yokozi-jp/agent-software-factory/issues/323) で決めます。

## 出典

- `Idempotency-Key` の形式 (Structured Field の String)、キーがないときの 400、ペイロードが違うときの 422、処理中の 409、期限の公開: [draft-ietf-httpapi-idempotency-key-header-08](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-08.txt) (2.1、2.3、2.5.2、2.7。2026-10-28 に確かめた)
- 一意索引が、commit していない別のトランザクションの同じ値を待つこと: [PostgreSQL: 63.5 Index Uniqueness Checks](https://www.postgresql.org/docs/current/index-unique-checks.html) (2026-10-28 に確かめた)
- `SET LOCAL` の効果がトランザクションの終わりまで続くこと: [PostgreSQL: SET](https://www.postgresql.org/docs/current/sql-set.html)。`lock_timeout` が暗黙のロックの待ちにも効くこと: [PostgreSQL: Client Connection Defaults](https://www.postgresql.org/docs/current/runtime-config-client.html)。`55P03` が `lock_not_available` であること: [PostgreSQL: Appendix A. Error Codes](https://www.postgresql.org/docs/current/errcodes-appendix.html) (2026-10-28 に確かめた)
- Stripe v1 のキーの保存期間 (少なくとも 24 時間)、500 の保存、`Idempotent-Replayed`: [Stripe: Low-level error handling](https://docs.stripe.com/error-low-level) (2026-10-28 に確かめた)。Stripe v2 の 30 日、Adyen の 7〜14 日、PayPal の Orders API の 6 時間: Issue #231 の調査で、各社の文書を 2026-10-26 に読んだ ([Stripe v2](https://docs.stripe.com/api-v2-overview)、[Adyen](https://docs.adyen.com/development-resources/api-idempotency/)、[PayPal](https://developer.paypal.com/reference/guidelines/idempotency/))
- `crypto.randomUUID()` が v4 UUID を作り、secure context でだけ使えること: [MDN: Crypto.randomUUID()](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) (2026-10-28 に確かめた)
- hono-idempotency 0.9.1 の振る舞い: [paveg/hono-idempotency](https://github.com/paveg/hono-idempotency) の src を Issue #231 の調査で 2026-10-26 に読んだ (動かしていない)
- 同じキーの 2 つの要求、`tenant_id` を含めない一意キー、`lock_timeout` を戻さないときの `55P03`: PostgreSQL 17 のコンテナで実行した ([Issue #231](https://github.com/yokozi-jp/agent-software-factory/issues/231) と [Issue #232](https://github.com/yokozi-jp/agent-software-factory/issues/232) の解決コメント)
