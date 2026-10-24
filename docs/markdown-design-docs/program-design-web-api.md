---
type: Convention
title: "プログラム設計書 (Web API)"
description: "Web API のプログラム設計書で `openapi.yaml` と重複する内容を省くことと、応答項目の由来を示す表の形式を定める文書。Web API のプログラム設計書を作るときに読む。"
tags: [markdown-design-docs, convention, backend, web-api]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forMarkdown/markdown_design_document.html
    title: Markdown設計ドキュメント規約
    author: フューチャー株式会社
---

# プログラム設計書 (Web API)

Web API のプログラム設計書も機能 ID 単位で作るが、`openapi.yaml` と重複する自明な内容は省略する。
複数テーブルを参照する検索 API では、項目の由来を示す応答例の表を定義する。
出典は [Markdown設計ドキュメント規約](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## プログラム設計書（Web API）

Web APIについても、プログラム設計書（バッチ、非同期タスクなど）と同様に機能ID単位で作成する。

ただし、Web APIにおいては `openapi.yaml` と重複する部分で自明な内容（例えばリクエストパラメータの定義や、レスポンス項目）については、重複するため記載を省略する。

もし、検索APIで複数のテーブルを参照して結果を応答する場合に、項目の由来を示すため、下表のような形式を定義すること。

### Web API応答例

| Parameter       | Description   | Settings      | Note |
| --------------- | ------------- | ------------- | ---- |
| last_name       | 氏名 (姓)     | m_user        |      |
| first_name      | 氏名 (名)     | m_user        |      |
| last_name_kana  | 氏名カナ (姓) | m_user        |      |
| first_name_kana | 氏名カナ (名) | m_user        |      |
| date_of_birth   | 生年月日      | m_user_detail |      |
| gender_type     | 性別区分      | m_user_detail |      |
| tel             | 電話番号      | m_user_detail |      |
| occupation_type | 職業区分      | m_user_detail |      |
| zipcode         | 郵便番号      | m_user_detail |      |

※Descriptionは `openapi.yaml` 側の `description` で記載済みであれば、省略すること。
※Noteは何かしら加工処理により生み出された項目であれば、計算ロジックを記載する。
