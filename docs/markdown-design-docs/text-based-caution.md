---
type: Convention
title: "Markdown 設計書のテキストベースの注意点"
description: "Markdown 設計ドキュメントで列数の多い表を扱うときの注意を定める文書。設計書をテキストベースにするか、表形式をどのファイル形式で持つかを判断するときに読む。"
tags: [markdown-design-docs, convention, documentation]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forMarkdown/markdown_design_document.html
    title: Markdown設計ドキュメント規約
    author: フューチャー株式会社
---

# Markdown 設計書のテキストベースの注意点

設計ドキュメントは種別ごとに記載内容と Markdown の構造を規約化する。
列数が多い表は Markdown だと保守性が下がるため、数十項目以上になり得る場合は Excel などのファイル形式を推奨する。
出典は [Markdown設計ドキュメント規約](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

本ガイドラインでは、アプリケーションの種別ごとに設計ドキュメントへ記載すべき内容と、それをどのような Markdown の構造で記載するかを規約化する。

## テキストベースにおける設計書の注意点

特に扱いで留意すべき点として、列数が多い表形式で設計ドキュメントを記載するケースがある。

Markdownは表を記載可能だが、列数が多い場合は保守性が非常に低くなり、`git diff` を用いた差分を確認できるメリットも下がる。

例えば、1つの画面の利用項目数が数十以上になり得る場合は、Excelなどのファイル形式を利用することを推奨する。
