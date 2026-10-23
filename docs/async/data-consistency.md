---
type: Convention
title: "データ整合性"
description: "複数の SaaS や DB をまたぐ非同期処理のデータ整合性を保つ方式 (Saga パターン/手動リカバリ) を定める規約。分散した処理の整合性が問題になるとき、補償トランザクションを検討するときに読む。"
tags: [async, convention, data-consistency, saga]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forAsync/async_guidelines.html
    title: 非同期設計ガイドライン
    author: フューチャー株式会社
---

# データ整合性

非同期箇所を減らす設計の工夫を Saga より先に検討し、業務上許容できないケースのみ Saga パターン (補償トランザクション) を採用する。
補償 API の準備が難しい場合や発生頻度が低い場合は手動リカバリも検討し、いずれもリトライで発生頻度を減らす。
出典は [非同期設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## データ整合性

マイクロサービスアーキテクチャや、SaaS連携と同様に、非同期処理でも「データ整合性」をどのように保つかが問題になりやすい。

例えば、ユーザーがサインアップした際の、複数SaaS連携を含む以下の顧客登録フロー（下図）を想定する。

1. 自社DBにユーザーを作成
2. 顧客管理（Salesforceなど）に顧客レコードを作成
3. 決済基盤SaaS に請求アカウントを作成

この時、3の非同期部分でエラーが発生し、かつ回復不能の場合は、データ不整合が継続してしまう。

```mermaid
%%{init: {'sequence': {'mirrorActors': false}}}%%
sequenceDiagram
    autonumber
    actor User as ユーザー
    participant Worker as 注文処理
    participant DB as ① 自社DB
    participant SF as ② 顧客管理<br>(Salesforceなど)
    participant PQ as 決済キュー
    participant PW as 決済ワーカー
    participant Z as ③ 決済基盤<br>(SaaS)

    User->>Worker: サインアップ (リクエスト)
    activate Worker

    rect rgb(240, 255, 240, 0.5)
        note right of Worker: メイン処理完了 (Commit)
        Worker->>DB: ユーザー作成 (TX)
        DB-->>Worker: OK

        Worker->>SF: 顧客レコード作成 (API Call)
        SF-->>Worker: OK

        Worker->>PQ: 請求アカウント作成依頼 (非同期)
        Worker->>DB: commit
        Worker-->>User: Accepted
    end
    deactivate Worker

    PQ-->>PW: 決済ジョブ受信
    activate PW

    rect rgb(255, 240, 240, 0.5)
        note right of PW: 異常発生<br>同期部分と決済基盤でデータ不整合
        PW->>Z: 請求アカウント作成 (API Call)
        activate Z
        Z--xPW: ❌ タイムアウト / エラー
        deactivate Z
    end

    deactivate PW
```

上記のような場合で、データ整合性を担保する主な方式は下表の通り。

| \#           | （1）Sagaパターン                                                     | （2）手動リカバリ                                                                    |
| :----------- | :-------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| 説明         | 失敗したら、取り消す処理（補償トランザクション）を走らせる            | 失敗したら「人を呼ぶ」                                                               |
| 説明         | A→B→Cと進み、Cで失敗したら、Bの取消処理→Aの取消処理を実行して元に戻す | エラー時はアラートを上げ、不整合な状態を許容し、運用担当者がデータパッチ等で修正する |
| データ整合性 | ✅️高 。APIに取り消し機能が必要。副作用が残る場合あり                  | ✅高。複雑な業務判断が必要な場合に有効                                               |
| 実装コスト   | ❌高。元に戻すロジックが難しい                                        | ✅低。検知のみ                                                                       |
| 運用コスト   | ✅️低い。自動化できるため                                              | ⚠️リカバリ                                                                           |

Sagaパターンは以下のフローである。補償トランザクションは簡略表示のため決済ワーカーで行っている。本来はキューを経由した処理に切り出すべきである。

```mermaid
%%{init: {'sequence': {'mirrorActors': false}}}%%
sequenceDiagram
    autonumber
    actor User as ユーザー
    participant Worker as 注文処理
    participant DB as ① 自社DB
    participant SF as ② 顧客管理<br>(Salesforceなど)
    participant PQ as 決済キュー
    participant PW as 決済ワーカー
    participant Z as ③ 決済基盤<br>(SaaS)

    User->>Worker: サインアップ (リクエスト)
    activate Worker

    rect rgb(240, 255, 240, 0.5)
        note right of Worker: メイン処理完了 (Commit)
        Worker->>DB: ユーザー作成 (TX)
        DB-->>Worker: OK

        Worker->>SF: 顧客レコード作成 (API Call)
        SF-->>Worker: OK

        Worker->>PQ: 請求アカウント作成依頼
        Worker->>DB: commit
        Worker-->>User: Accepted
    end
    deactivate Worker

    PQ-->>PW: 決済ジョブ受信
    activate PW

    rect rgb(255, 240, 240, 0.5)
        note right of PW: 異常発生
        PW->>Z: 請求アカウント作成 (API Call)
        activate Z
        Z--xPW: ❌ タイムアウト / エラー
        deactivate Z

        note over PW, Z: 【Saga開始: 補償トランザクション実行】

        %% --- 補償処理（Sequential: DB -> SF）---
        note right of PW: ユーザーレコード削除
        PW->>DB: ユーザーレコード削除
        DB-->>PW: OK

        note right of PW: 顧客レコード削除
        PW->>SF: 顧客レコード削除
        SF-->>PW: 削除完了
        PW->>DB: commit
    end

    deactivate PW
```

推奨は以下の通り。

- Saga以前に設計上の工夫で非同期箇所を減らせないか検討する
  - 例えば、決済基盤への決済アカウント作成までは同期で行い、顧客管理への連携側を非同期化とする。Salesforce連携が万が一遅延しても、売上には影響しないため許容すると判断する。これにより、顧客管理側への登録が失敗しても、補償トランザクションで打ち消すのではなく、その後の運用や救済ジョブで顧客管理側へ後で登録するという一方通行で済ませる
- 在庫引当のように、失敗したまま放置すると自社の機会損失となり、業務上許容できないようなケースでのみ、（1）を採用する
- Sagaパターンを実現するための取り消しAPIの準備が難しい場合や、発生頻度が低いとされる場合は（2）で様子を見ることも検討する
  - 例えば、非同期でのメール送信は取り消すことができない。そのため、別のメールで「取り消しました」と送信するしか無い
  - Sagaは複雑な実装のためバグの出る可能性が高い。またレアケースであれば、人間による判断の方がトータルコストは安くなる可能性が高い
- （1）（2）のどちらであっても、[リトライ](retry-and-visibility-timeout.md#リトライ) を組み込むことで発生頻度を減らす工夫を必須で行う
