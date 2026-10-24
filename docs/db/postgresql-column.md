---
type: Convention
title: "PostgreSQL のカラム（生成列・データ型）"
description: "PostgreSQL の生成列の利用方針と、データ型の選択方針を定める文書。カラムの型を設計するときに読む。"
tags: [db, postgresql, convention, column]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL のカラム（生成列・データ型）

生成列は原則利用せず、導出属性の考え方に準じる。
データ型はシステムで統一した方針を持って選ぶ。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## カラム

### 生成列

生成列は他の列から計算されるビューのようなものである。 生成列には格納と仮想の2種類があり、PostgreSQLは格納生成列のみサポートする。

- 格納生成列は実際にストレージが割り当てられる、マテリアライズドビューに似ている
- 仮想生成列は列の参照時に計算される、ビューに似ている

> [!TIP]
> **PostgreSQL 18からは仮想生成列もサポートされる**
>
> PostgreSQL 18で仮想生成列がサポートされ、**キーワードを省略した場合は仮想生成列がデフォルト**となる。17以前からのマイグレーションでは、`STORED` の指定漏れにより意図せず仮想生成列となる点に注意する。
>
> - [5.4. 生成列 - PostgreSQL 18文書](https://www.postgresql.jp/docs/18/ddl-generated-columns.html)

以下の特徴がある。

- 明示的にINSERT/UPDATEができない（DEFAULTキーワードの指定は可能）
- 現行の行のみを指定できる
- 生成式はほかの生成列を参照できない
- 生成列はパーティションキーにできない
- 概念的には、生成列はBEFOREトリガーが走った後に更新される

主なユースケースは以下である。

- 単価・数量カラムで「金額」を生成
- 氏名カラムから、「フルネーム」を生成
- JSON項目のある要素を、別カラムとして生成する（下に例を記載）
- pg_bigmで部分一致検索用途に、小文字変換した検索用のカラムを追加

```sql
-- JSONBを含むテーブル
CREATE TABLE json_data_table (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data JSONB NOT NULL,
    name TEXT GENERATED ALWAYS AS (data ->> 'name') STORED,
    age INTEGER GENERATED ALWAYS AS ((data ->> 'age')::INTEGER) STORED
);

-- データの挿入
INSERT INTO json_data_table (data) VALUES ('{"name": "John Doe", "age": 30}');
INSERT INTO json_data_table (data) VALUES ('{"name": "Jane Doe", "age": 25}');

-- 参照
SELECT id, name, age FROM json_data_table;
 id |   name   | age
----+----------+-----
  1 | John Doe |  30
  2 | Jane Doe |  25
```

推奨は以下の通り。

- DB論理設計については [導出属性](postgresql-logical-design-snapshot.md#導出属性) 章の考え方に準じる
- 生成列は、原則利用しない
  - 生成列で実現したい要件は、ビジネス要件やアプリケーションライフサイクルに近いため
  - 式変更のリリース作業が難しいため（AccessExclusiveLockと全レコード探索を必要とするため）

> [!NOTE]
> **参考**
>
> - [5.3. 生成列](https://www.postgresql.jp/docs/17/ddl-generated-columns.html)
> - [Is it possible to add a GENERATED COLUMN to a large table without locking/downtime on postgres? - Database Administrators Stack Exchange](https://dba.stackexchange.com/questions/324349/is-it-possible-to-add-a-generated-column-to-a-large-table-without-locking-downti)

### データ型

PostgreSQLにはユーザーの使用可能な豊富な[データ型](https://www.prisma.io/dataguide/postgresql/introduction-to-data-types)が存在する。そのうえで、システムで利用するポリシーを統一すると開発生産性 / 保守性を高められる。例えば、商品コードを数値型、社員コードを文字列型で定義すると、「コード値」でありながら型が揺れ、DB利用者が少なからず混乱してしまう。設計の一貫性を保つには、何かしらの方針が必要である。

推奨は以下の通り。

- 利用するデータ型種別数をなるべく絞り込む方針とする
  - 設計者によってどの型を利用するか、判断のゆらぎをなるべく減らすため
  - DBスキーマからコード生成する場合や、独自ツールを開発するうえで、ハマりうる事項をなるべく減らすため
  - 多少の非効率さ（データ容量、処理性能）より、業務システムでは上記の設計品質の安定性、開発生産性を重視するため

【凡例】✅️:必須で付与する

| カラム値種別       | データ型                                   | 非NULL | Default | 説明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :----------------- | :----------------------------------------- | :----- | :------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| コード             | `varchar(n)`                               |        |         | 商品コード、支店コードなど。 コード値が数字であっても、文字列として扱う。                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 区分               | `varchar(n)`                               | ✔      |         | 値が数字だとしても、区分はコードの一種として扱うため文字列とする（例: 性別区分: `Not known:0` `Male:1` `Female:2` `Not applicable:9`）。 上記ISO 5218で定義された区分値は数字以外を取りえないため、idとして格納するほうが本来効率的である（参考: [文字列型の使い分け - Let's POSTGRES](https://lets.postgresql.jp/documents/technical/text-processing/1)）。一方で、業務区分値は現時点で数字のみだったとしても、将来的に変化する可能性は否定できない。安全側に倒し、一部の非効率さより設計の一貫性を重視するため、varcharを用いる。 |
| 日時               | `timestamptz` (`timestamp with time zone`) |        |         | タイムゾーン付きを選択する。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 日付（yyyy-MM-dd） | `date`                                     |        |         | `date` ではなく `varchar(10)` を用いる流派もあるが、好みの問題である。より入る値が明示的となるdate型を利用する。 なお、日付項目はパーティションキーとして利用することが多いが、date、varcharのどちらを利用しても機能としては問題ない。パーティションキーの場合はNOT NULL制約を付ける。                                                                                                                                                                                                                                              |
| 年月（yyyy-MM）    | `varchar(7)`                               |        |         | 月次パーティションを作成する場合に利用することが多い。パーティションキーの場合は`NOT NULL`制約を付ける。 ハイフンは、PostgreSQLのデフォルト日付フォーマットが `yyyy-MM-dd` の拡張書式であるため、それに合わせて入れる                                                                                                                                                                                                                                                                                                               |
| 数量               | `bigint` `integer`                         |        |         | 在庫数 / 受発注数 / 入出荷数など。連番がbigintを用いる規則であるため、それに相当するカラムの場合はbigintを利用する。 なお、業務およびシステム上、integerで事足りる場合はintegerの利用も許容する。デフォルト値は0にしない                                                                                                                                                                                                                                                                                                            |
| 連番               | `bigint`                                   | ✔      |         | `integer`/`serial`の場合、一巡によりシーケンスのリセットや後々`bigint`/`bigserial`に切り替えるなどの作業が発生する懸念がある。安全側に倒すため`bigint`を用いる。IDENTITY列にすることで`serial`は利用しない                                                                                                                                                                                                                                                                                                                          |
| 係数               | `numeric(p, s)`                            |        |         | 割引率 / 消費税率 など。floatは利用しない。要件次第だがデフォルト値は0にしない                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 金額 / 計算結果    | `numeric(p, s)`                            |        |         | 支払金額 / 請求金額 / 使用量など、正確な計算結果の格納が求められる場合。要件次第だがデフォルト値は0にしない                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 文字列             | `varchar(n)`                               |        |         | 名称 / 説明文など。textは桁数が不明となり、システム間連携やデータサイズ見積もりで扱いにくいため、使用しない                                                                                                                                                                                                                                                                                                                                                                                                                         |
| フラグ             | `boolean`                                  | ✔      | false   | 必ず`NOT NULL`制約を付与する。MySQLではbooleanはtinyint型に置き換えられる。tinyintは0と1以外の値を格納できるため、厳密なboolean型を扱うには挿入・更新時に値チェックが必要となり、MySQLではbooleanの利用に考慮が必要である。PostgreSQLでは上記の問題がないため推奨する。 フラグを`char(1)`やsmallintで表現する流派もあるが、入力値が明確になるという点でbooleanを用いる。[boolean型を別の型にできないか考える](postgresql-logical-design-snapshot.md#boolean型を別の型にできないか考える) 章も参考にする                             |
| UUID               | `uuid`                                     |        |         | `UUID`型か`varchar(36)`の選択があるが、`UUID`型の場合は16byteで済み、性能 / コスト上のメリットが大きい。なお、`gen_random_uuid()`も`UUID`型である                                                                                                                                                                                                                                                                                                                                                                                   |
| 配列               | `[]`                                       |        |         | 原則、配列は正規化を行い利用しない。もし、利用する場合は`json`/`jsonb` 型と同様の利用方針とする。                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 構造化データ       | `json` `jsonb`                             |        |         | 原則JSONデータは正規化を行い、`json`/`jsonb` 型は利用しない。 ただし、次の1、2のような場合は許容する 1️⃣外部のWeb API応答の生データをログ的に保存したい 2️⃣システム間連携で、自システムで利用せず横流しするだけの場合 ※JSON型は挿入が高速、JSONB型は検索が高速であるため、例えば2️⃣のケースではJSON型を利用する                                                                                                                                                                                                                        |

なお、次のデータ型は利用しない。理由は以下の通り。

- `timestamp`（ タイムスタンプ **without** time zone）
  - 代わりに `timestamptz`（タイムスタンプ **with** time zone）を用いる
  - Web APIなど異なるタイムゾーンの日時情報の入力があり、アプリケーション側でタイムゾーンの正規化が行われなかったとしても正しい時間で保存 / 利用できるため
  - 海外拠点でのアプリケーション利用など、異なるタイムゾーンでの利用時にも対応しやすくなるため
- `char`
  - 代わりに `varchar(n)` を用いる
  - データサイズの削減メリットがあり、対象のカラム値が最小桁数＝最大桁数 である場合に、それを明示する目的で`char` を利用したい場合がある
  - テストデータ投入・データパッチ・アプリケーション不備等が原因で桁不足があると、末尾にスペースが入る。それにより動作検証でハマる事が多い
  - 本ガイドラインでは後者の開発生産性観点を優先とし、利用を禁止とする
- `text` および長さの指定がない `varchar`
  - 代わりに長さを指定したvarcharを用いる
  - [Don't Do This - PostgreSQL wiki](https://wiki.postgresql.org/wiki/Don%27t_Do_This#Don.27t_use_varchar.28n.29_by_default) には、`varchar` ではなく `text` を使おうとあるが、これに従わず本ガイドラインでは禁止とする。
  - システム開発、特に基幹系やそれに近い領域ではシステム間連携が前提となり、連携用のWeb APIやファイルのスキーマ定義が求められる。その際に桁数の上限が存在しないと、連携先システムの都合（採用しているDBなどの制約）によっては対処できない場合があるため
  - 桁数があると、テーブルサイズの見積もりにも役立つ
  - `text` 型にindexを貼ると、データサイズによってはエラーになるため、通常インデックスを貼る用途は無いと考えられるが、万が一利用する場合は注意する（<https://zenn.dev/onozaty/articles/postgresql-text-index>）
- `serial`
  - 代わりに `bigint`（IDENTITYカラム）を用いる
  - 当初は呼び出し数が少ないと想定しても、想定以上のアクセス数が来ることや稼働が続くと、`integer`/`serial`で不足するケースも否定できない
  - シーケンス値が1周するとアプリケーション改修が大変になることが多く、型を `integer`/`serial` -> `bigint`/`bigserial` に変更する運用の難易度も高いため。最初から保護主義的に `bigint` を採用する
  - `serial` の代わりに、よりSQL標準であるIDENTITY列を利用する
- `smallint`
  - 代わりに `integer` または `bigint` を用いる
  - 設計者に選択させる余地をできる限り減らすため
- `real` および `float(1)` ～ `float(24)`
  - 浮動小数点が必要な場合は、代わりに `double precision` を用いる
  - ドキュメント（[PostgreSQL: Documentation: 18: 8.1. Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html)）によると、`real`（= `float4`）の精度は小数点6桁程度、`double precision`（= `float8`）は15桁程度である。また精度指定のない `float` は `double precision` を意味する。DBの型がJavaやGoなどの型にマッピングされることが多く、計算結果の精度に影響することを考えると、精度の低い `real` を避け `double precision` を利用し、精度落ちを事前に回避する方針とする
- `money`（通貨）型
  - 代わりに桁数と適切な精度を設定した `numeric` を用いる

> [!TIP]
> **`integer` ではなく `bigint` に統一すべきかどうか**
>
> 整数型はintegerとbigintを使い分けることが本ガイドラインの推奨だが、設計の揺れを防ぐためや、考慮漏れなどで`integer` から `bigint` への型変更を完全に避けるために、多少のオーバーヘッドを許容して `bigint` に統一する考え方もある。これについては意見の分かれることが多く、採用についてはシステムのワークロードや設計上のトレードオフを考慮して検討すること。

<!-- 前の注記と分ける -->

> [!WARNING]
> **char(n) 型にハマる**
>
> `char(n)` 型はカラム値が桁数未満の場合に、半角スペースでパディングされる仕様がある（桁数超過の場合はエラーになるが、桁数以下の場合はエラーにならない）。
> そのため、単体テストデータの比較などで、見た目は正しいが半角スペースの存在で値が不一致となり、テストが落ちてしまうことがある。初心者がよく陥るミスの1つであり、初見殺しである。
>
> 以下に例を示す。
>
> ```sql
> CREATE TABLE sales_category (
>     code_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
>     category_code CHAR(8) -- 固定長8文字
> );
>
> -- ダミーデータ登録（5文字）
> INSERT INTO sales_category (category_code) VALUES ('DUMMY');
> ```
>
> SQLで検索すると、表示上は `DUMMY` に見えるが、`CONCAT()` で文字列結合すると半角スペースが3桁でパディングされた値に `123` が追加されていることがわかる。
>
> ```sql
> # SELECT category_code, CONCAT(category_code, '123') FROM sales_category;
>  category_code |  concat
> ---------------+-----------
>  DUMMY         | DUMMY   123
> (1 row)
> ```
>
> 回避策としては宣言された桁数（先程の例では8文字）でテストデータを登録することが考えられるが、開発者の負荷が高まる。そのため `varchar(n)` を代わりに使い、発生原因を根本から無くすことを推奨する。

<!-- 前の注記と分ける -->

> [!NOTE]
> **参考**
>
> [Don't Do This - PostgreSQL wiki](https://wiki.postgresql.org/wiki/Don%27t_Do_This)
