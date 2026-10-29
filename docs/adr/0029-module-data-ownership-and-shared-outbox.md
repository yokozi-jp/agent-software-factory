---
type: ADR
title: "ADR 0029: モジュールの表は DB のロールで所有を分け、モジュールをまたぐ変更は共有の Outbox のイベントでつなぐ"
description: モジュールのデータの所有と Outbox の決定。Outbox は共有のスキーマ messaging の表 1 つ、1 つのトランザクションは 1 つのモジュールの表だけを書く、ほかのモジュールは依存の方向なら公開関数で読み逆らうならイベントで写す、スキーマをまたぐ外部キーと view は使わない、受信は processed_message で重複を除く、モジュールごとの NOLOGIN のロールで直接の SQL を止める、Outbox を送る処理はログインできる別のロール outbox_relay で全テナントを読む（ADR 0011 の唯一の例外）、所有者の権限で動く view と SECURITY DEFINER の関数を置かない。比べた案は、モジュールごとの Outbox、Outbox を RLS から外す案、送る処理をテナントごとに回す案、BYPASSRLS、モジュールごとのログインできるロール、型だけに任せる案、lint でスキーマ名を探す案、外部キー。モジュールの表を足すとき、モジュールをまたいで読み書きしたくなったとき、Outbox や受信の処理を書くとき、DB のロールや権限を変えるとき、ADR 0011 の RLS の例外を足したくなったときに読む。
tags: [adr, architecture, modules, db, postgresql, outbox, rls, roles]
---

# ADR 0029: モジュールの表は DB のロールで所有を分け、モジュールをまたぐ変更は共有の Outbox のイベントでつなぐ

各モジュールは自分の表を持ち、ほかのモジュールの表を直接読み書きしません。[ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md) の import の検査は、この規則を見つけられません。型の生成だけでも、`` sql`…` `` の中の SQL は止まりません。そこで、規則を DB の権限に落とし、モジュールをまたぐ変更は Outbox のイベントでつなぎます。決定は [Outbox など共有の表の置き場所と、ほかのモジュールのデータを読む経路を決める](https://github.com/yokozi-jp/agent-software-factory/issues/212) の解決コメントにあります。ロール、表、検査の実装は [Issue #268](https://github.com/yokozi-jp/agent-software-factory/issues/268) と [Issue #269](https://github.com/yokozi-jp/agent-software-factory/issues/269) です。

## ルール

- **Outbox の置き場所**: 共有のスキーマ `messaging` の表 `outbox` を 1 つ置きます。型は kysely-codegen でこのスキーマだけを生成して `packages/shared` に置き、各モジュールは行を入れるだけです。Outbox の表そのものをキューにはしません ([ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md))。
- **トランザクションの範囲**: 1 つのトランザクションは、1 つのモジュールの表だけを書きます。モジュールをまたぐ変更は Outbox のイベントでつなぎ、結果整合にします。例外は設けません。
- **ほかのモジュールを読む経路**: 依存の方向 (締め → 承認 → 申請。[ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md)) に沿って読むときは、相手の `index.ts` の公開関数を同じプロセスで呼びます。方向に逆らって相手の変化を知るときは、イベントを受け取り、必要な値を自分の表に写します。
- **view と外部キー**: ほかのモジュールを読むための view は作りません。スキーマをまたぐ外部キーも置かず、ほかのモジュールの行は id だけで持ちます。参照先が存在するかは、書く前に公開関数で確かめます。
- **受信の重複除去**: イベントを受け取るモジュールが、自分のスキーマに `processed_message` (キー `(tenant_id, message_id)`) を置き、業務の処理と同じトランザクションで行を入れます。行があれば何もしません。Outbox を送る処理は、メッセージを送った後で行を更新するので、更新の前に失敗すると同じメッセージをもう一度送ります ([メッセージ送信の信頼性](../async/message-reliability.md) の図 2)。届け方は少なくとも 1 回で、コンシューマーは 2 回以上起動されることがあります ([QoS](../async/qos.md))。SQS の FIFO の重複除去は 5 分の間だけです。
- **モジュールのロール**: モジュールごとに `NOLOGIN` のロール `<module>_module` を作り、自分のスキーマの `USAGE` と行の読み書き、`messaging.outbox` の `INSERT` だけを与えます。`app_user` は `GRANT <module>_module TO app_user WITH INHERIT FALSE, SET TRUE` で入り、自身はどのモジュールのスキーマも読めません。`shared` のトランザクションの補助関数が、開始の直後に `SET LOCAL ROLE <module>_module` と `set_config('app.current_tenant', …, true)` を実行します。どちらもトランザクションの終わりで戻るので、接続プールに残りません。`GRANT … WITH INHERIT` と `SET` のオプションは PostgreSQL 16 以降です。
- **Outbox を送る処理のロール**: ログインできる別のロール `outbox_relay` で接続します。権限は `messaging.outbox` の `SELECT`、`UPDATE`、`DELETE` だけです。秘密は Secrets Manager の別の秘密にし、送る処理の入口 (ECS のワーカー、Lambda の送る関数) にだけ渡します。`app_user` は `outbox_relay` のメンバーにならず、`SET ROLE` で切り替えられません。
- **Outbox の RLS**: `messaging.outbox` も `tenant_id` を持ち、`ENABLE` と `FORCE ROW LEVEL SECURITY` を付けます。モジュールのロールには、`INSERT` と、`app.current_tenant` で比べるポリシーだけを与えます。`outbox_relay` には `USING (true)` のポリシーを与え、全テナントの行を読めるようにします。
- **所有者の権限で動くものを置かない**: モジュールのスキーマに、所有者の権限で動く view (`security_invoker` が `true` でないもの) と `SECURITY DEFINER` の関数を置きません。migration 用のロールが所有するこれらは、所有者の権限で動き、ロールの分離を迂回できます。

## ADR 0011 の例外

[ADR 0011](0011-tenant-id-and-rls-from-the-start.md) は、バッチをテナントごとに実行し、「`BYPASSRLS` を持つロールで全テナントを一度に処理しない」としています。`outbox_relay` は `BYPASSRLS` を持ちませんが、`USING (true)` のポリシーで `messaging.outbox` の全テナントの行を一度に読みます。これが、ADR 0011 の「全テナントを一度に処理しない」への唯一の例外です。例外にした理由は次のとおりです (判断)。

- 送る処理はテナントをまたいで未送信の行を拾う処理で、テナントごとに回すと、テナントの一覧が要り、起動のたびにテナントの数だけクエリが走ります。
- 例外は `messaging.outbox` の `SELECT`、`UPDATE`、`DELETE` に限ります。`BYPASSRLS` と違い、ほかの表は読めません。
- 全テナントを読める権限は、アプリのコードから手が届かない別のログインに閉じ込めます。

この例外を増やしません。`outbox_relay` 以外のロールに `USING (true)` のポリシーを足したくなったら、この ADR を直します。

## 検査

規則は守るのが難しいので、次を検査にします。止める仕組みと動く場所は次のとおりです。

| 規則                                                                                                                           | 止める仕組み                                                                                                                                                                                                                     | 動く場所                      |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1. 1 つのトランザクションは 1 つのモジュールの表だけ。ほかのスキーマへの SQL を書かない                                        | DB のロールの権限 (permission denied)。トランザクションの型をモジュールごとに分ける                                                                                                                                              | 結合テスト、`vp check`        |
| 2. `SET ROLE` と `set_config` は `shared` の補助関数でだけ。接続は入口のファイルが作り、モジュールは `pg` の値を import しない | [ADR 0019](0019-custom-oxlint-plugin-for-xss.md) の自作の Oxlint plugin の規則。`pg` の値の import は、[ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md) の `no-restricted-imports` で止める (`import type` は通す) | `vp check`                    |
| 3. ロールの形                                                                                                                  | カタログのテスト (`NOLOGIN`、`INHERIT FALSE`、各ロールの権限、`app_user` が `outbox_relay` のメンバーでないこと、`modules` の名前ごとのスキーマとロール)                                                                         | 結合テスト                    |
| 4. 所有者の権限で迂回しない                                                                                                    | カタログのテスト (view は `security_invoker = true` だけ、`SECURITY DEFINER` の関数なし)。スキーマをまたぐ外部キーなし (`pg_constraint`)                                                                                         | 結合テスト                    |
| 5. RLS の例外は `outbox_relay` の 1 つだけ                                                                                     | カタログのテスト (`pg_policies`)。ADR 0011 の RLS のカタログのテストを広げる                                                                                                                                                     | 結合テスト                    |
| 6. 受け取る処理は `processed_message` で重複を除く                                                                             | 処理の登録を `shared` の関数 1 つに限り、全処理に同じメッセージを 2 回渡すテスト                                                                                                                                                 | 結合テスト                    |
| 7. `outbox_relay` の秘密は送る処理の入口にだけ                                                                                 | CDK の assertions のテスト                                                                                                                                                                                                       | CDK の stack を書くときに足す |
| 8. 業務の処理から SQS や SES などを直接呼ばない (外への副作用は Outbox を通す)                                                 | `no-restricted-imports` で、SQS、SES、SNS、EventBridge、Lambda、Step Functions の SDK のクライアントの import を止める。送る処理と、SES で送るコンシューマーの入口だけが、理由つきの override で許される                         | `vp check`                    |

検出力は、lint の規則を fixture で、カタログのテストを、わざと規則を破る SQL を流した使い捨ての DB で確かめます ([センサーの検出力を確かめる方式を決める](https://github.com/yokozi-jp/agent-software-factory/issues/43))。[保証カタログ](../tooling/assurance-catalog.md) には、「モジュールの表の所有」「Outbox の権限」「受信の重複除去」の 3 行を足します。検査の実装がそろうまで、行は「これから足す行」の節に置きます。

止まらないものがあります。コードが意図して別のモジュールのロールへ `SET ROLE` することです。これはガードレールで、境界ではありません ([エージェントの権限の線引きを決める](https://github.com/yokozi-jp/agent-software-factory/issues/33) と同じ扱いです)。

## 標準との違い

- **Outbox が表 1 つ**: 標準に沿っています。Spring Modulith は表 `event_publication` を 1 つ置き、スキーマを `spring.modulith.events.jdbc.schema` で選びます ([Appendix](https://docs.spring.io/spring-modulith/reference/appendix.html)、[spring-modulith#685](https://github.com/spring-projects/spring-modulith/issues/685))。モジュールごとの Outbox は、[kgrzybek/modular-monolith-with-ddd](https://github.com/kgrzybek/modular-monolith-with-ddd#37-modules-integration) の形です (モジュールごとに Outbox と Inbox の表を 2 つとバックグラウンドの処理を置く)。
- **トランザクションの範囲**: Spring Modulith の既定に沿っていますが、例外のない規則にしたのは判断です。`@ApplicationModuleListener` は、コミットの後に `REQUIRES_NEW` の新しいトランザクションで動きます ([Working with Application Events](https://docs.spring.io/spring-modulith/reference/events.html))。ただし、イベントの発行は既定で同期で、同じトランザクションの中で動くリスナーも書けます。例外を残すと、エージェントがどちらを選ぶか迷います。また、モジュールのロールによる分離 (上の規則 1) は、1 つのトランザクションが 1 つのロールで動くことを前提にします。kgrzybek/modular-monolith-with-ddd も、モジュールはデータを共有せず、複数のモジュールにまたがるトランザクションを作らないとしています ([3.7 Modules Integration](https://github.com/kgrzybek/modular-monolith-with-ddd#37-modules-integration))。
- **view を使わない**: 相手のスキーマの形が SQL の上で契約になり、型の生成の範囲も広がるためです (判断)。
- **外部キーを置かない**: 外部キーの検査は RLS を迂回するため、参照先のテナントの行の有無が漏れます ([PostgreSQL 5.9 Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html))。また、外部キーを作るには参照先の表の `REFERENCES` が要ります。この権限を持つロールは、外部キーの強制を通して、表の所有者の権限で任意の関数 (cast 関数など) を呼ばせられます ([5.8 Privileges](https://www.postgresql.org/docs/current/ddl-priv.html))。モジュールのロールに他のモジュールの表への権限を与えると、分離が崩れます。削除の順序もモジュールをまたいで縛られます。
- **モジュールごとのロール**: PostgreSQL の [5.10.6 Usage Patterns](https://www.postgresql.org/docs/current/ddl-schemas.html#DDL-SCHEMAS-PATTERNS) は、スキーマの使い方の型 (利用者ごとのスキーマなど) を示すだけです。Spring Modulith の文書の設定項目 ([Appendix](https://docs.spring.io/spring-modulith/reference/appendix.html)) には、モジュールごとに DB の権限を分けるものが見つかりませんでした。モジュールごとのロールは、これらより強い形で、標準というより判断です。`WITH INHERIT FALSE, SET TRUE` で入ったロールは、`SET ROLE` した後だけ相手の権限を持ちます ([SET ROLE](https://www.postgresql.org/docs/current/sql-set-role.html))。
- **所有者の権限で動くものを置かない**: view は既定で所有者の権限で基の表を調べます ([CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html))。`SECURITY DEFINER` の関数も所有者の権限で動くので、どちらもロールの分離を迂回します。
- **避けるアンチパターン**: Outbox の表そのものをキューにすること。SQS の重複排除だけで、ちょうど 1 回処理されると思い込むこと。全スキーマに権限を持つ 1 つのアプリのロールで、所有の境界を規約の文書だけに頼ること。

## Considered Options

- **モジュールごとの Outbox**: kgrzybek/modular-monolith-with-ddd の形です。モジュールを別の DB に分けるための形で、その予定がありません。ADR 0013 の送る処理は 1 つの関数なので、3 つの表を順に読むことになります。
- **Outbox を RLS から外す**: 送る処理は全行を読めますが、ADR 0011 のカタログのテストの例外が `auth` のほかに増えます。
- **送る処理をテナントごとに回す**: ADR 0011 の規則のままですが、上の「ADR 0011 の例外」のとおり、テナントの一覧と、起動のたびのテナントの数のクエリが要ります。
- **`BYPASSRLS` のロール**: ADR 0011 に反し、Outbox のほかの表も読めます。
- **`app_user` から `SET LOCAL ROLE outbox_relay`**: 全テナントを読める権限に、すべてのアプリのコードから手が届きます。
- **モジュールごとにログインできるロールと接続プールを分ける**: 分離は強くなりますが、モジュールが 3 つなら接続が 3 倍になり、秘密も 3 つ要ります。Lambda から Aurora への接続の数に響きます (判断)。
- **型 ([Issue #209](https://github.com/yokozi-jp/agent-software-factory/issues/209)) だけに任せる**: `` sql`…` `` が型の検査をすり抜けます。
- **`sql` の中のスキーマ名を lint で探す**: 文字列を組み立てると見逃します。
- **読み取り専用の view**: 相手のスキーマの形が SQL の上で契約になります。上の「標準との違い」を参照してください。
- **方向に沿う外部キーだけを許す**: 外部キーの検査が RLS を迂回し、削除の順序がモジュールをまたいで縛られます。上の「標準との違い」を参照してください。

## Consequences

- 表を足すモジュールは、自分のスキーマに表を置き、`<module>_module` のロールに権限を与えます。別のモジュールの表を読みたくなったら、公開関数かイベントにします。
- 結果整合になるので、モジュールをまたぐ変更は、受け取る側が途中の状態を見ても壊れないように書きます。受け取る側は、同じメッセージを何度受け取っても結果が変わらないようにします (`processed_message`)。
- [ADR 0025](0025-kysely-and-dbmate-sql-first.md) は、アプリのロールを `migrator`、`app_user`、`auth_service` とし、「secret は RDS が管理する master user のものだけ」としています。`outbox_relay` は別の秘密を持つので、この記述と合いません。どちらに合わせるか (別の秘密を置くか、IAM DB authentication にして秘密を置かず IAM の権限で分けるか) は、[Issue #269](https://github.com/yokozi-jp/agent-software-factory/issues/269) で決め、ADR 0025 を直します。
- この ADR の検査は、実装 ([Issue #268](https://github.com/yokozi-jp/agent-software-factory/issues/268)、[Issue #269](https://github.com/yokozi-jp/agent-software-factory/issues/269)) までは働きません。それまではレビューで守ります。

## 確かめられなかったこと

- この ADR の SQL (ロール、`GRANT`、ポリシー) は、実際の DB では流していません。PostgreSQL の挙動は公式文書で確かめました。実機での確認は Issue #268 で行います。
- 公開関数が別のモジュールの表を読むとき、呼び出し元のトランザクション (呼び出し元のモジュールのロール) の中で動くのか、公開関数が自分のトランザクションを開くのかは、決めていません。1 つのトランザクションが 1 つのモジュールの表だけを書く規則と、テナントの設定の引き継ぎを合わせて、Issue #268 で決めます。
- Aurora PostgreSQL の版は、CDK の stack を書くときに確かめます。

## 出典

- Spring Modulith の `@ApplicationModuleListener` と、イベントの発行が既定で同期であること: [Working with Application Events](https://docs.spring.io/spring-modulith/reference/events.html) (2026-10-27 に確かめた)
- `spring.modulith.events.jdbc.schema` と、モジュールごとに DB の権限を分ける設定項目が見つからないこと: [Appendix](https://docs.spring.io/spring-modulith/reference/appendix.html)。`event_publication` の表: [spring-modulith#685](https://github.com/spring-projects/spring-modulith/issues/685) (2026-10-27 に確かめた)
- PostgreSQL: [GRANT](https://www.postgresql.org/docs/current/sql-grant.html) の `INHERIT` と `SET` のオプション、[リリース 16](https://www.postgresql.org/docs/release/16.0/) で足された `GRANT … WITH INHERIT` と `SET` (2026-10-27 に確かめた)
- スキーマの使い方の型: [5.10.6 Usage Patterns](https://www.postgresql.org/docs/current/ddl-schemas.html#DDL-SCHEMAS-PATTERNS)。ロールの切り替え: [SET ROLE](https://www.postgresql.org/docs/current/sql-set-role.html)。view が所有者の権限で動くこと、`security_invoker`: [CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html) (2026-10-27 に確かめた)
- 外部キーと RLS: [5.9 Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)。`REFERENCES` の権限: [5.8 Privileges](https://www.postgresql.org/docs/current/ddl-priv.html) (2026-10-27 に確かめた)
- モジュールをまたぐトランザクションを作らないこと、モジュールごとの Outbox: [kgrzybek/modular-monolith-with-ddd の 3.7 Modules Integration](https://github.com/kgrzybek/modular-monolith-with-ddd#37-modules-integration) (2026-10-27 に確かめた)
- SQS の FIFO の重複除去の間隔 (5 分): [Exactly-once processing in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html) (2026-10-27 に確かめた)
