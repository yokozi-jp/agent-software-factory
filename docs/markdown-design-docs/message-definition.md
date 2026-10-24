---
type: Convention
title: "メッセージ定義書"
description: "メッセージ定義書に書く識別子、レベル、ステータス、メッセージの形式を定める文書。アプリのメッセージを設計書に起こすときに読む。"
tags: [markdown-design-docs, convention, backend, message]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forMarkdown/markdown_design_document.html
    title: Markdown設計ドキュメント規約
    author: フューチャー株式会社
---

# メッセージ定義書

メッセージは識別子、レベル、ステータス、メッセージ、コメントの表で定義する。
出典は [Markdown設計ドキュメント規約](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## メッセージ定義

> [!TIP]
> **メッセージ定義サンプル**
>
> ```md
> ## メッセージ定義
>
> | 識別子 | レベル | ステータス | メッセージ                                 | コメント                     |
> | ------ | ------ | ---------- | ------------------------------------------ | ---------------------------- |
> | 10001  | E      | 400        | ユーザー名またはパスワードが間違っています | ログイン画面で発生           |
> | 10002  | W      |            | 文字数オーバーです                         | ログイン画面で発生           |
> | 10003  | E      | 500        | {domain}は無効なユーザードメインです       | ユーザーの所属が異なっている |
> | 10004  | F      | 500        | EntraIDに接続できません                    | ログインのバックエンドで発生 |
> ```
