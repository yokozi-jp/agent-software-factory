---
type: Convention
title: "PostgreSQL のクライアント管理"
description: "PostgreSQL のコネクションプール、O/R マッパ、このリポジトリの Kysely の書き方 (接続、生成した型、テナントの設定、入力の渡し方、入れ子の結果)、SQL チューニング方針を定める文書。アプリから DB に接続する実装を設計するとき、Kysely でクエリを書くとき、モジュールの DB の型を生成し直すときに読む。"
tags: [db, postgresql, convention, client]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL のクライアント管理

コネクションプール、O/R マッパ、このリポジトリの Kysely の書き方、SQL チューニングの方針を定める。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## クライアント管理

### コネクションプール

コネクションプールは、DBとの接続をあらかじめ確保しておき、それを再利用する仕組みである。Webサーバーなど常駐型のアプリケーションがDBに接続する際、毎回新しい接続を確立するのではなく、プールから既存の接続を取得して使用することで、コネクション生成時の負荷を軽減し、応答時間を短縮できる。

コネクションプールの設定値は、アプリケーションの特性やDBの負荷状況などを考慮して決定する。最終的には本番相当のシナリオで性能試験をしたうえで、設定値の妥当性を担保することが望ましい。

| 項目           | 推奨                                                                                                                                                                |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 最小アイドル数 | コネクションプールのアイドル状態で保持する接続数を設定する。通常のリクエスト量に対して対応できる接続数を最低限として設定する                                        |
| 最大接続数     | コネクションプールが確保できる最大の接続。ピーク時にも耐えられる接続数を設定する。過度に大きな値はDBそのものに影響を及ぼすため、避ける                              |
| 最大待機時間   | コネクションプールから接続を取得する際に、接続が空くまでの最大待機時間を設定する                                                                                    |
| 最大寿命       | コネクションプールに生存する最大時間。 定期的にコネクションを破棄することで、意図せず不安定になったコネクションを取り除き、自律的な復旧が可能になる。必須で設定する |

なお、プロセスが短命なバッチ処理の場合は、利用するDBアクセスが通常1つであるため、アプリケーションでコネクションプールを利用しないほうが効率的である。小さなバッチ処理が大量に起動するような場合は、RDSプロキシのようにミドルウェア側にコネクションプールを持たせることも検討する。

> [!NOTE]
> **参考**
>
> [Re: Configuring sql.DB for Better Performance](http://dsas.blog.klab.org/archives/2018-02/configure-sql-db.html)

### O/Rマッパ

O/Rマッパ（Object-Relational Mapping）はプログラミング言語のオブジェクトとDBテーブルを対応付ける仕組みで、これを用いることで以下のメリットがある。

- SQLを書かずに済む
- 画面から複数の検索条件を指定できる場合に、サーバー上で動的にクエリを作成しやすい

推奨は以下の通り。

- SQLに1対1で対応しないO/Rマッパ（関連の自動の読み込みや、発行するSQLを隠すAPIを持つもの）は利用しない
  - クエリ結果をその言語のオブジェクトなどにマッピングするライブラリの利用は問題ない
  - 書いたとおりのSQLを組み立てる型付きのクエリビルダーは利用してよい。このリポジトリは Kysely を使う（[ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md)）
- ビルダーで書けない構文（ヒント句など）は、値を bind 変数にするタグ付きテンプレート（Kysely の `` sql`…` ``）で書く
- 動的なクエリ作成は、2Way-SQL かクエリビルダーで、条件ごとの断片を組み立てる

理由は以下の通り。

- スロークエリが発生した場合に、O/Rマッパを利用しているとDBAなど必ずしもその言語 / フレームワークに精通しているとは限らない専門家が、チューニングを実施しにくい
- O/Rマッパの関連テーブルの扱いでトラブルとなった時に検知しにくい。そういった機能の有無を調査する必要がある。一口にO/Rマッパといっても、期待値がメンバーで揺れやすい
- コードレビュー時にレビュアーが、O/Rマッパの発行したクエリを確認しにくい
- ヒント句による実行計画の制御が行いにくい

> [!TIP]
> **単一テーブル操作のSELECT/INSERTなどの操作は許容したい？**
>
> SQLで結合しないSELECT/INSERTなどの操作は許容したいという声も多いが、以下の観点から許容しない。
>
> - 単一テーブル操作は、SQL / O/Rマッパでの実装の揺れる可能性がある。揺れさせない場合、単一テーブル時はO/Rマッパの使用を強制することになり開発ルールが増える
> - 将来的なDB切り替えを伴うリプレイスでの、SQL自動変換対象のスコープを絞るため
> - 実装方針を寄せない場合、影響度調査などのコストがあがる（静的解析などの手間も）ため、許容できない
>   - 例えば、どのアプリケーションが、どのテーブル×カラムを利用しているか調査したい場面も多い。実装方針が統一されているとLinterだけではなく、こういった解析ツールの手間も減る
> - 単一テーブル操作でO/Rマッパ実装を許容した場合、保守運用フェーズなどプロジェクトライフサイクルの最後まで、テーブル結合が必要になったタイミングでSQLにリライトすることが守られるかと言うと疑問であるため

### このリポジトリの Kysely の書き方

このリポジトリのクエリは Kysely で書く。決定と根拠は [ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md) と [ADR 0029](../adr/0029-module-data-ownership-and-shared-outbox.md) にある。

- **接続**: 入口のファイル (`apps/api/src/server.ts`) が `app_user` の `Pool` を `@agent-software-factory/db` の `createPool` で作り、`createModuleDatabases` (`apps/api/src/db/databases.ts`) が `PostgresDialect` に渡す。モジュールには、そのモジュールの DB の型 (`ClaimDatabase`、`ApprovalDatabase`、`ClosingDatabase`。各モジュールの `index.ts` が export する) の `Kysely` だけを渡す。
- **型**: migration を流した PostgreSQL から、kysely-codegen がモジュールのスキーマごとに `packages/<モジュール>/src/infrastructure/db.gen.ts` を生成する。手で書き換えない。migration を変えたら、`pnpm exec nx db-types db` で生成し直して commit する。CI の「DB types match the migrations」が、生成し直した型と違うと失敗する ([CI](../tooling/ci.md))。
- **日時**: `createPool` の接続は、`timestamptz` を `Temporal.Instant`、`date` を `Temporal.PlainDate` で読み、`timestamp` は読むと例外にする ([ADR 0043](../adr/0043-instants-in-utc-business-calendar-in-tokyo-with-temporal.md))。pg の既定は `Date` で、`date` がプロセスの TZ の 0 時になる。書きは `Temporal` の値を渡さず、`toString()` の文字列で渡す。生成した型も、読みが `Temporal`、書きが `string` で、`Temporal.Instant` を書きの値にすると型検査が止まる (`typeMapping`、`packages/db/src/types.ts`)。Better Auth の接続は `Date` を前提にするので、`createPool` を使わない。
- **表の名前**: スキーマ付きで書く (`selectFrom("claim.t_claim")`)。型にはそのモジュールのスキーマの表しかないので、ほかのモジュールの表を引くクエリはコンパイルエラーになる。ほかのモジュールのデータは、そのモジュールの `index.ts` の公開 API の関数で読む ([ADR 0029](../adr/0029-module-data-ownership-and-shared-outbox.md))。その関数は、呼び出し元のトランザクションを引数で受け取り、ロールを切り替えずにその中で読む。自分ではトランザクションを開かず、中で `trx.withTables<自分の DB>()` を呼んで自分の表を型付きで引く。`withTables` は各モジュールの `infrastructure/` でだけ呼べる。`` sql`…` `` の中の SQL は型の検査を通らない。そのため、モジュールの package では `kysely` の `sql` と `CompiledQuery`、`pg` の import を lint で止める。要るときは、理由を書いた disable コメントにする。ほかのモジュールの表への書き込みと、依存の方向に逆らう読み取りは、モジュールごとのロール (`<モジュール>_module`) の権限で permission denied になる。
- **テナント**: テナントの表を読み書きするクエリは、`@agent-software-factory/shared` の `inTenantTransaction(db, { module, tenantId }, work)` の `work` の中で、渡されたトランザクションに対して書く。`SET ROLE` や `set_config('app.current_tenant', …, true)` を自分で書かない。補助関数が開始の直後に `SET LOCAL ROLE <モジュール>_module` とテナントの設定を実行し、どちらもトランザクションの終わりで戻る ([ADR 0011](../adr/0011-tenant-id-and-rls-from-the-start.md)、[ADR 0029](../adr/0029-module-data-ownership-and-shared-outbox.md))。`shared` と `apps/api` では、この SQL を `sql` の中に書くと自作の Oxlint plugin の規則が止める。
- **入力の値**: 値はビルダーの引数か、`` sql`…${value}` `` の bind 変数で渡す。`sql.raw`、`sql.lit`、`sql.ref`、`sql.table`、`sql.id` には入力の値を渡さない。どれも値を SQL の文に直接埋め込み、Kysely の型定義に「確かめていない入力を渡すと SQL injection になる」と書かれている (kysely 0.29.7 の `dist/raw-builder/sql.d.ts`)。並び替えの列などを入力で選ぶときは、許す名前の一覧と照らしてから使う。
- **入れ子の結果**: 親の行ごとに子の行の配列を返すときは、`kysely/helpers/postgres` の `jsonArrayFrom` (1 行なら `jsonObjectFrom`) で、SQL の副問い合わせとして書く ([Kysely: Relations](https://kysely.dev/docs/recipes/relations))。行ごとにクエリを投げる書き方 (N+1) にしない。
- **関連の自動の読み込み**: Kysely にはない。関連を自動で読み込む plugin やライブラリを足さない (上の O/R マッパの推奨)。

### SQLチューニング方針

SQLの書き方は [https://future-architect.github.io/coding-standards/documents/forSQL/](https://future-architect.github.io/coding-standards/documents/forSQL/) に準じる。

ヒント句については以下の方針とする。

- 開発時は全クエリに記載せず、原則プランナーが作成する実行計画に委ねる
- もし、実行計画が何かしらの理由で想定通りにならない、安定しないなどの理由で固定化したい場合に限り、ヒント句、後述のSET、WITH句（CTE(Common Table Expressions)によるクエリの書き換え）で固定化する

理由は以下の通り。

- ヒント句を知ったばかりの時は、できる限りヒント句による調整をしたくなってしまうが、SQLクエリの保守運用性が低下するため
  - なぜそのヒント句を付けたか、引き継ぎされたメンバーが混乱する
  - クエリ改修時に、ヒント句と整合性を保つことが難しいため

ヒント句を記載したが上手く効かない場合は、SETでのパラメータ調整をしたくなる場合がある。例えば、Nested Loop Joinに限定したい場合、マージジョイン、ハッシュジョインを無効化できる。書き方は下表の3種類が存在し、本ガイドラインでは3を推奨する。

| 手法                            | 例                                                                                                                | 説明                                                                                         |
| :------------------------------ | :---------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| １．アプリからSET LOCAL呼び出し | SET LOCAL enable_mergejoin = off; SET LOCAL enable_hashjoin = off;                                                | SQLクエリチューニング時に調整しにくい。                                                      |
| ２．SQL中でSET LOCAL            | SET LOCAL enable_mergejoin = off; SET LOCAL enable_hashjoin = off; SELECT xxx FROM （省略）                       | SQLクエリチューニングでは問題ないが、コード生成などツール面でハマる可能性がある              |
| ３．SQLヒント句上に記載 ☆推奨   | /\*+ Set(enable_mergejoin off) Set(enable_hashjoin off) Leading((a b)) NestLoop(a b) \*/ SELECT xxx FROM （省略） | SQLクエリチューニングに適し、ツール面でハマる可能性が低い（SQLコメントとして解釈されるため） |

> [!NOTE]
> **参考**
>
> - [PostgreSQL 10からNested Loop Joinを選びにくい - そーだいなるらくがき帳](https://soudai.hatenablog.com/entry/2020/11/09/173851)
> - [パフォーマンスチューニング9つの技 ～はじめに～｜PostgreSQLインサイド : 富士通](https://www.fujitsu.com/jp/products/software/resources/feature-stories/postgres/article-index/tuningrule9-introduction/)
> - [SET](https://www.postgresql.jp/document/16/html/sql-set.html)
