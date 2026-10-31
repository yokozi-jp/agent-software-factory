---
type: Reference
title: DB設計ガイドラインの出典と適用範囲
description: docs/db/ の出典 (フューチャー株式会社の DB 設計ガイドライン、CC BY 4.0)、変更点、適用範囲、免責事項。docs/db/ の規約がどこまで適用されるかを確かめるとき、出典やライセンスを確かめるときに読む。
tags: [db, reference, license, source]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/
    title: DB設計ガイドライン
    author: フューチャー株式会社
---

# DB設計ガイドラインの出典と適用範囲

`docs/db/` の文書は、フューチャー株式会社の [DB設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forDB/) を元にしている。
DB設計に関するガイドラインとして、PostgreSQL設計ガイドラインとDynamoDB設計ガイドラインの2本を提供する。

## 出典とライセンス

- 原文: [DB設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forDB/) (フューチャー株式会社、[future-architect/arch-guidelines](https://github.com/future-architect/arch-guidelines))
  - [PostgreSQL設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html)
  - [DynamoDB設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forDB/dynamodb_guidelines.html)
- ライセンス: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)
- PostgreSQL設計ガイドライン
  - 作成者: 真野隼記、武田大輝、宮崎将太、澁川喜規、村田靖拓、岸本卓也、関根直弥、清水雄一郎
  - レビュアー: 杉江伸祐、二村暢之、佐々木伸悟、辻大志郎、尾崎駿
- DynamoDB設計ガイドライン
  - 作成者: 真野隼記、後藤玲雄、武田大輝、村田靖拓、村瀬善則、宮崎将太、市川燿、山本竜玄、澁川喜規
  - レビュアー: 八木雅斗、大江聖太郎

### 原文からの変更点

- 1つの文書を、責務ごとに複数の文書に分けた。PostgreSQL と DynamoDB の文書は、key を `postgresql-` / `dynamodb-` で始めて区別する。
- 各文書に OKF の frontmatter と、冒頭の要約を足した。
- VitePress の記法 (`<page-title/>`、`::: tip` などのコンテナ、見出しの `{#id}`) を、GitHub の Markdown の記法 (`> [!TIP]` など) に置き換えた。
- 原文の章へのリンクを、分割後の文書へのリンクにした。このリポジトリに取り込んだ他のガイドラインへのリンクは、その docs/ の文書へのリンクにした。取り込んでいないガイドライン (AWS、Terraform、データマネジメント、Git ブランチフロー) へのリンクは、原文のサイトの URL にした。
- 原文の図 (画像) を mermaid の図、または文章に置き換えた。RDB / DynamoDB の設計プロセス、データ連携方式、キャッシュパターン、RPO/RTO と復旧シナリオ、DynamoDB の選定フローは mermaid の図にし、DynamoDB のプライマリーキーの例 (`pk_sk.png`) は図の内容を文章にした。表のセルの中にある図は、変換器が表の直後に「図N」として出す。
- Markdown の検査を通すため、次を直した。見出しのレベルが飛んでいる 5 箇所を1つ上の見出しの直下のレベルにした。太字だけの行 (「【命名ルールの例】」「【例】メジャーバージョンアップ方針」) を見出しにした。Go のコードのタブをスペースにした。
- 実行計画の制御の表で、原文の `/_+ ... _/` を pg_hint_plan のヒント句の書き方 `/*+ ... */` に直した。原文の `*` が Markdown の強調として `_` に崩れていたと判断した。
- postgresql-version.md の LTS/EOL の表 (2024年10月断面で固定) を、現時点のサポート対象 (14〜18) の簡潔な記述と、一次情報 (PostgreSQL Versioning Policy、Aurora/RDS の Release calendar) への参照に置き換えた。PostgreSQL: Versioning Policy。
- dynamodb-sdk-test.md の LocalStack の推奨に、今の提供条件を足した。原文は他の AWS サービスのエミュレータとして LocalStack の利用を無条件で推奨している。LocalStack は 2026-03-23 から1つのイメージとアカウントのプランに移り、CI を含めて auth token が要る。無料の Hobby プランは商用目的の利用を禁じ、OSS 版のリポジトリは archived になった。そこで、推奨を、これらの条件を満たせる場合に限った形にし、公式の DynamoDB local を第一に検討する推奨は残した。LocalStack Pricing、Auth Token (LocalStack Docs)、localstack/localstack リポジトリ。
- postgresql-client.md の O/R マッパの推奨を、「SQL を記載しないクエリビルダーは使わない」から「SQL に1対1で対応しない O/R マッパは使わない。書いたとおりの SQL を組み立てる型付きのクエリビルダーは使ってよい」に改め、sqlc などのコード生成の推奨を外した。原文の理由 (DBA の調整、関連の扱いの事故、レビューで SQL が見えにくい) は SQL を隠す ORM に当たり、Kysely のように SQL に1対1で対応するビルダーにはほとんど当たらないと判断した。TypeScript の SQL からの型の生成は、sqlc-gen-typescript が 0.1.3 (2024-01) の early access で、PgTyped が 2.4.3 (2025-03) で止まっている。ADR 0025、sqlc-gen-typescript の README、PgTyped の npm の公開日。
- postgresql-client.md の O/R マッパの節の後に、このリポジトリの Kysely の書き方 (接続、モジュールのスキーマごとの生成した型、スキーマ付きの表の名前、テナントの補助関数、`sql.raw` などに入力を渡さないこと、入れ子の結果の `jsonArrayFrom`、関連の自動の読み込みを足さないこと) の節を足した。原文は特定のクエリビルダーの書き方を定めていない。ADR 0025、ADR 0029、kysely 0.29.7 の `dist/raw-builder/sql.d.ts`、Kysely: Relations。
- postgresql-migration.md のスキーママイグレーションツールの節に、このリポジトリが使うツール (dbmate) と正本 (版付きの SQL のマイグレーションファイル) を足した。原文はツールを指定しない。ADR 0025。
- postgresql-migration.md に、このリポジトリの migration の書き方 (ファイルの置き場所、`lock_timeout`、`transaction:false`、down の書き方、前に進めるだけ、expand と contract、表の形 (複合の主キー、連番のサロゲートキー、共通カラムの型と桁)、型の生成し直し) の節を足した。原文はツールを指定せず、書き方も定めていない。決定は ADR 0025、守っているかの検査は repo-policy。
- postgresql-migration.md に、このリポジトリの seed (置き場所、流し方、冪等にしないこと、migration と同じ PR で直すこと、本番と検証環境で流さないこと) の節を足した。原文は seed を扱わない。ADR 0036。
- postgresql-test.md の「各テストにおけるトランザクションの扱い方」に、結合テストのテンプレートの DB に migration に続けて seed を入れること、各テストは seed にない自分のテナントでデータを書き、seed の行を読まないことを足した。原文は、各テストが利用テーブルの全レコードを DELETE して事前データを登録する前提で、テンプレートの DB の seed を想定していない。ADR 0036。
- postgresql-migration.md の「前に進めるだけ」に、前の版のアプリが PR の migration を適用した後のスキーマで動くことを CI の更新の試験が確かめる、という説明と ADR 0037 へのリンクを足した。原文は更新の試験を定めていない。ADR 0037。
- postgresql-i18n.md の「タイムゾーン管理」を、ユーザーのタイムゾーンを `utc_offset INTERVAL` の列で持つ例から、持たない既定 (業務のタイムゾーンが1つ) と、持つ場合は IANA の名前にする説明に書き換えた。「夏時間は廃止方向」は一次情報を確かめられなかったので消した。オフセットだけでは夏時間の規則を復元できず、RFC 9557 と Temporal は IANA の名前を持つ。PostgreSQL 17 Documentation 8.5 Date/Time Types、RFC 9557、ADR 0043。
- postgresql-functions-triggers.md の `sysdate()` の例の後に、このリポジトリでは現在時刻とタイムゾーンを DB の関数に持たせず、SQL で日時から暦日や境界を作らない、という説明を足した。原文は Oracle 互換の例を許容するだけで、タイムゾーンの扱いを定めていない。ADR 0043。
- postgresql-keys.md の UUID を DB 側で生成する記述を、PostgreSQL 18 以降は組み込みの `uuidv7()` で拡張不要、17 以前は拡張 (またはアプリ側) が必要、とバージョンで条件づけた。PostgreSQL 18 Documentation 9.14 UUID Functions。
- postgresql-keys.md の参考リンクのうち、到達不能 (404) の 2 件 (terra-drone.net と zenn.dev/uncode_jp/articles/dcf20a2c5b0d76) を削除した。curl による HTTP 404 の確認。
- postgresql-column.md のデータ型で、存在しない型名 `double` を `double precision` に直し、`real` は約6桁・`double precision` は約15桁・精度指定のない `float` は `double precision` を意味する、と精度の記述を正した。PostgreSQL: Documentation 8.1 Numeric Types。
- モジュールごとの `NOLOGIN` のロール (`claim_module` など) を使い、自分のスキーマの読み書きと依存の方向のスキーマの `SELECT` だけを与えることは、postgresql-roles.md の「テーブル単位で細かく権限制御しすぎないようにする」からはみ出す。原文はこの推奨の理由を書いていないので、権限が細かいと管理が難しくなることを避ける趣旨と読む (判断)。このリポジトリでは、モジュールの表の所有を型だけでなく DB で止める必要があり、権限はスキーマ単位で `GRANT` と `ALTER DEFAULT PRIVILEGES` にまとめ、表ごとには書かない。権限の形は、カタログのテストが毎回確かめる。ADR 0029、Issue #268。
- concurrency-testing.md を足した。競合と原子性を確かめる結合テストの書き方 (`pg_blocking_pids` で待ちを確かめる手順、対照、行数の前後比較) で、原文にない。Issue #352 の決定。
- postgresql-concurrency.md の「楽観的ロック」に、このリポジトリでは案 1（`UPDATE … WHERE lock_no = $n` の更新件数で比べる）を採る、という節を足した。原文は案 2（`SELECT FOR UPDATE` でバージョンを比べる）を推奨する。採る理由（比較と更新が 1 文で書き忘れても穴が開かない、EF Core と同じ方式、ロックの時間が短い、READ COMMITTED で競合した UPDATE は更新後の行で WHERE を再評価する）、0 行のときの 404 と 409 の分け方、案 2 を使う場面を書いた。EF Core の Optimistic concurrency、PostgreSQL 13.2.1。Issue #345、#362。
- postgresql-keys.md に、このリポジトリの共通カラムの値の入れ方（アプリがバインドする、`packages/shared-kernel` の `createdColumns`、`updatedColumns`、`patchedColumns`）、楽観排他の書き方、キーと制約の書き方（`tenant_id` を含む主キーとユニークインデックス、外部キーと CHECK 制約を置かない）の節を足した。原文にない。Issue #345、#362。
- convention-check.md を足した。docs/db の規約のうち、migration を流した DB のカタログで機械的に確かめる項目と、確かめない項目、例外の書き方 (`packages/db/src/convention-catalog.ts`) で、原文にない。Issue #361 の決定。検査は規約の本文に合わせた。`float` は `real` だけを止め (`postgresql-column.md` の「使わない型」)、共通カラムは `postgresql-keys.md` の表の 12 個にした。
- postgresql-parameters.md の末尾に、テストが起動する使い捨ての PostgreSQL に限り、永続化の設定 (`fsync`、`synchronous_commit`、`full_page_writes`) を off にする、という段落を足した。原文のパラメータの方針は本番 (RDS/Aurora) の話で、テスト用の DB は扱っていない。PostgreSQL 公式の Non-Durable Settings に沿った設定で、本番のパラメータは変えない。ADR 0038。

## 位置づけ

### PostgreSQL設計ガイドライン

本ガイドラインはPostgreSQLを使用する開発者向けに、DBのテーブルやカラムの命名・型桁・制約などのスキーマ管理に加え、履歴・排他制御・マルチテナント対応などアプリケーション設計を含む内容についての設計標準を紹介する。これによりDB設計の主な論点 / 設計項目 / 設計観点を提供することで、開発者の考慮漏れを防ぐとともに、チームでの設計上の合意形成を手助けし、システム開発における標準ラインとなる設計手法を提供することでナレッジやツールの横展開を容易にすることを目指す。

前提条件は以下の通り。

- 利用データベース：PostgreSQL
- ワークロード： OLTP（オンライントランザクション処理）の業務システム開発
- 主にクラウド上のマネージドサービスの利用（Amazon Auroraを利用など）

### DynamoDB設計ガイドライン

AWS が提供するフルマネージドな NoSQLデータベースサービスである、DynamoDBの技術選定・命名・データモデリング・パーティショニング・性能・費用・監視・運用・セキュリティなどの考慮すべき設計事項と推奨案をまとめる。

適用範囲は以下の通り。DynamoDB を利用してシステムを構築する全てのエンジニアおよびアーキテクトを対象とする。業務システムの開発を想定しており、開発スピードの優先度が高いPoCや、学習目的の趣味の開発は除く。数名以上の開発チームがあり、運用保守まで見据え、安定して動作することが求められるとする。

対象外となる事項は以下の通り。

- DynamoDB の詳細なAPIリファレンスや具体的なコーディング実装例を網羅するものではない。それらについては、AWS公式ドキュメントや各プログラミング言語のSDKドキュメントを参照すること
- DynamoDBをセッションストレージのような、限定的な用途で使うようなケース。本ガイドラインの内容は要件に対して過剰な設計になる可能性がある
- 特定のビジネス領域やアプリケーション固有の要件に特化した設計判断については、本ガイドラインの原則を踏まえつつ、各プロジェクトで個別検討すること
- DynamoDBを利用する前提として、AWSそのものの命名や設計が必要になる。[AWSインフラ命名規約](https://future-architect.github.io/coding-standards/documents/forAWSResource/AWS%E3%82%A4%E3%83%B3%E3%83%95%E3%83%A9%E3%83%AA%E3%82%BD%E3%83%BC%E3%82%B9%E5%91%BD%E5%90%8D%E8%A6%8F%E7%B4%84.html) や [AWS設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forAWS/aws_guidelines.html) を参考にすること
- インフラ構築はTerraformなどのプロビジョニングツールの利用を推奨する。[Terraform設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forTerraform/terraform_guidelines.html) を参考にすること

DynamoDB設計ガイドラインで用いる用語は以下の通り。

| 用語                                  | 説明                                                                                                                           |
| :------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------- |
| 読み込みキャパシティユニット（RCU）   | 1秒あたりに読み込み可能なデータ量の単位                                                                                        |
| 書き込みキャパシティユニット（WCU）   | 1秒あたりに書き込み可能なデータ量の単位                                                                                        |
| カバードクエリ                        | クエリ対象のすべての属性がインデックスに射影（プロジェクション）されており、テーブル本体への読み込み無しで結果を返せるクエリ   |
| TTL (Time To Live)                    | アイテムに有効期限のタイムスタンプを設定し、期限が切れたアイテムを自動的にテーブルから削除する機能                             |
| 未処理のアイテム (UnprocessedItems)   | BatchGetItemやBatchWriteItemなどのバッチ処理で、プロビジョニングされたスループットの不足などにより、処理しきれなかったアイテム |
| 条件付き書き込み (Conditional Writes) | 特定の条件が満たされた場合にのみ書き込みを操作する仕組み                                                                       |
| 冪等性                                | 同じ処理を複数回実行しても、結果が常に同じになる性質                                                                           |
| DLQ (デッドレターキュー)              | 処理に失敗したメッセージやイベントを隔離するためのキュー                                                                       |

## 免責事項

原文の免責事項を引用する。

> [!WARNING]
>
> - 有志で作成したドキュメントである。フューチャーには多様なプロジェクトが存在し、それぞれの状況に合わせて工夫された開発プロセスや高度な開発支援環境が存在する。本ガイドラインはフューチャーの全ての部署 / プロジェクトで適用されているわけではなく、有志が観点を持ち寄って新たに整理したものである
> - 相容れない部分があればその領域を書き換えて利用することを想定している。プロジェクト固有の背景や要件への配慮は、ガイドライン利用者が最終的に判断すること。本ガイドラインに必ず従うことは求めておらず、設計案の提示と、それらの評価観点を利用者に提供することを主目的としている
> - 掲載内容および利用に際して発生した問題、それに伴う損害については、フューチャー株式会社は一切の責務を負わないものとする。掲載している情報は予告なく変更する場合がある
