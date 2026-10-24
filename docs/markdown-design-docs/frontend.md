---
type: Convention
title: "フロントエンドの設計ドキュメント"
description: "フロントエンドの設計で Figma と Markdown 設計書のどちらに何を書くかを定める文書。画面の見た目とロジックの記載先を分けるときに読む。"
tags: [markdown-design-docs, convention, frontend, figma]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forMarkdown/markdown_design_document.html
    title: Markdown設計ドキュメント規約
    author: フューチャー株式会社
---

# フロントエンドの設計ドキュメント

画面遷移と画面表示項目は Figma で定義し、Figma で判断できる見た目の情報は Markdown 設計書に記載しない。
Markdown 設計書には Web API の呼び出し、イベントの定義、パラメータの受け渡し、バリデーションロジックなどを書く。
出典は [Markdown設計ドキュメント規約](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## フロントエンド

以下の方針を取る。

- Figmaを用いて、画面遷移、画面表示項目を定義する
- Markdown設計書には、Figmaで判断可能な見た目の情報は **記載しない**
- Markdown設計書には、Web APIの呼び出しやイベントの定義、パラメータの受け渡し、バリデーションロジックなどを定義する。

[サンプル設計書](https://github.com/future-architect/arch-guidelines/tree/main/documents/forMarkdown/sample)を参考にする。
