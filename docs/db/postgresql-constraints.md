---
type: Convention
title: "PostgreSQL の制約"
description: "PostgreSQL の主キー・外部キー・NOT NULL・検査・一意・排他の各制約の利用方針を定める文書。テーブルに制約を設計するときに読む。"
tags: [db, postgresql, convention, constraint]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL の制約

主キー・外部キー・NOT NULL・検査・一意・排他の各制約について、利用方針と注意点を定める。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 制約

### 主キー制約

利用について制限はない。データモデルに即して適切に設定すること。
関連する「一意制約」 「ユニークインデックス」の章も参照すること。

### 外部キー制約

外部キー制約は、列の値が他テーブルの値と一致しなければならないことを指定し、テーブル間の参照整合性を維持する。アプリケーションではなく、DB層でデータ整合性を守れるため利点は大きい。

以下は売上ヘッダー / 売上明細で外部キー制約を使った例である。

```sql
CREATE TABLE sales_header (
    sales_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sales_date DATE NOT NULL,
    customer_id BIGINT NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales_detail (
    detail_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sales_id BIGINT NOT NULL,
    sales_item_id BIGINT NOT NULL,
    quantity INT NOT NULL,
    sales_unit_price NUMERIC(10, 2) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sales_detail_sales_header FOREIGN KEY (sales_id)
        REFERENCES sales_header(sales_id)
);
```

推奨は以下の通り。

- 論理DB設計までは、論理設計として外部キー制約を作成する
- 実テーブルへのデプロイを行わない

理由は以下の通り。

| 観点                            | 説明                                                                                                                                                                                                                                                                                                                                                              |
| :------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 設計の揺れや間違い              | 外部キー参照の設計に揺れが生じやすい。例えば、外部キー参照を付ける / 付けないの判断基準を明確に設けることが難しい                                                                                                                                                                                                                                                 |
| 適切に設計を貫くコスト          | 「関連がある=外部キー制約をかける」は適切ではない。例えばユーザーアカウントと注文履歴は関連があるものの、ユーザーアカウントを削除した場合にも注文履歴は監査上残しておきたい場合がある。この例は分かりやすいが、より複雑なドメインでは設計ミスが発生しやすくなる（もちろん常に有識者をアサインし判断すべきだが、PJライフサイクルによっては不在になることもある）。 |
| 単体/性能テスト時のデータ登録   | 例えば、売上ヘッダー/売上明細の親子テーブルがある場合、親または子しか参照しない機能のテストでも、両方のテーブルにダミーデータを登録する手間がかかる。回避するためにはテスト時のみ外部キーなど制約を外す運用が必要だが、これを非推奨としたい前提がある。                                                                                                           |
| データ移行                      | 特に初期データ移行などCOPYで大量データを扱う際に課題になりやすい。外部キー制約を一時的に外すという手間がある。                                                                                                                                                                                                                                                    |
| 誤ったCASCADE理解による事故懸念 | ON DELETE、ON UPDATEなどの挙動を理解しないと、誤ったデータ削除をしてしまう懸念がある                                                                                                                                                                                                                                                                              |
| インデックス作成有無のハマり    | 外部キー制約をつけた場合に、参照先 / 元の両方にインデックス追加が必要。これは教育やツール（Linter）などで回避可能だが、ケアできない場合は性能劣化の懸念がある                                                                                                                                                                                                     |

> [!NOTE]
> **参考**
>
> [PostgreSQLアンチパターン：外部キー制約の更新コストを見くびる - Qiita](https://qiita.com/masudakz/items/ecbfc0f4ace2a7cef0f0)

### NOT NULL制約

データモデルに合わせて適切に設定する。 [データ型](postgresql-column.md#データ型) 章に関連する記載があるので、参照すること。

基本姿勢としてはできる限りNOT NULL化できないか考えることを推奨する。

例えば、[NULL撲滅委員会](https://mickindex.sakura.ne.jp/database/db_getout_null.html) の記事には、「未コード化用コード」の例がある。

> ISO の性別コードでは、１：男性、２：女性の他に、０：未知、９：適用不能という二つの未コード化用コードが体系に組み込まれています。
>
> コード９は法人に使われます。
>
> これは素晴らしい解決です。図らずもコッドが分類した二つの NULL、未知と適用不能に対応するコードが採用されています。

上記のように、「不明」を示す区分値を用意できないか検討する。

> [!TIP]
> **一時保存（下書き、仮登録）したいため、NOT NULL制約を付けられない？**
>
> NOT NULL制約の設計では、「一時保存（下書き、仮登録）といったステータス遷移があるため、画面で入力項目の全てを埋めてもらうことが難しい。そのため、NOT NULL制約の付与ができない」といった議論がしばしば行われる。
>
> しかし、一時保存（下書き・仮登録）状態をマスタ・トランとして保存するのではなく、ワークテーブル等に分離しておくと、本体側のテーブルにNOT NULL制約を付与できる可能性がある。一概に別テーブルとして分離することが正しい訳ではなくケースバイケースである。ただし、一時保存（下書き・仮登録）したいという要件のためにNOT NULL制約を全て外す必要がある場合は、別テーブル化できないかを第一に検討すべきである。

### 検査制約（CHECK制約）

以下のようなCHECK制約を用いると、データ整合性を保証するとともに、許容される値の範囲や条件の設計意図を明確に示せる。

```sql
CREATE TABLE event (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    start_date date NOT NULL,
    end_date date NOT NULL,
    CHECK (start_date < end_date)
);

CREATE TABLE contact (
    contract_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone_number varchar(11) CHECK (phone_number ~ '^\d{3}-\d{3}-\d{4}$')
);
```

適切にCHECK制約を利用することで、DB層で整合性が保たれメリットも大きいとされる。

推奨は以下の通り。

- CHECK制約の利用を禁止する（理由は [DOMAIN](postgresql-custom-types.md#domain) 章と同様の観点から）

### 一意制約

一意制約を作成すると、内部的にはユニークインデックスが作成される。一般的に、一意制約とユニークインデックスの使い分けを決めることが望ましい。

推奨は以下の通り。

- 一意制約ではなく、ユニークインデックスを利用する
  - 一意制約対象のカラムの追加 / 削除などのメンテナンスはゼロにできない。そのため、一意制約で暗黙的に作成されるインデックスではなく、明示的に作成すべきであるため

[ユニークインデックス](postgresql-index.md#２ユニークインデックス) の章を参照する。

### 排他制約

排他制約（EXCLUDE制約）は、主に空間 / 範囲の重複を排除するために利用する。典型的なユースケースは、会議室予約システムで同じ部屋の同じ時間帯の予約を不可とすることである。

```sql
CREATE TABLE room_bookings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id BIGINT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    EXCLUDE USING gist (
        room_id WITH =,
        tstzrange(start_time, end_time) WITH &&
    )
);
```

業務システム開発においては、マスタテーブルの適用開始日 / 終了日での利用が考えられる。

推奨は以下の通り。

- 適用開始日 / 終了日を持つカラムにおいては、積極的に利用する
- PostGISなど空間データについては、機能要件を踏まえ適切に導入を検討する
