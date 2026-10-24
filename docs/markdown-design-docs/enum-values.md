---
type: Convention
title: "区分値設計書"
description: "区分値 (ENUM) 設計書に書く区分値概要と区分値定義の形式を定める文書。区分値を設計書に起こすときに読む。"
tags: [markdown-design-docs, convention, backend, enum]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forMarkdown/markdown_design_document.html
    title: Markdown設計ドキュメント規約
    author: フューチャー株式会社
---

# 区分値設計書

区分値は概要 (目的、物理名、型、スコープ、マスターテーブル) と、論理名・物理名・値・バージョン・コメントの定義表で記載する。
出典は [Markdown設計ドキュメント規約](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 区分値

設計書サンプルを以下に示す。

> [!TIP]
> **区分値設計書サンプル**
>
> ```md
> # ENUM01 ユーザー権限
>
> ## 区分値概要
>
> - 目的: 画面のモードの切り替えに利用する
> - 物理名: user permission level
> - 型: string
> - スコープ: frontend, backend
> - マスターテーブル: m_user_role
>
> ## 区分値定義
>
> | 論理名             | 物理名          | 値  | バージョン | コメント |
> | ------------------ | --------------- | --- | ---------- | -------- |
> | ゲスト             | guest           | 01  | 1          |          |
> | 未認証ユーザー     | unauthenticated | 02  | 1          |          |
> | 登録ユーザー       | user            | 03  | 1          |          |
> | プレミアムユーザー | premium_user    | 04  | 2          |          |
> | 開発者             | developer       | 05  | 0          |          |
> | テスター           | tester          | 06  | 0          |          |
> | 管理者             | administrator   | 07  | 0          |          |
> ```
