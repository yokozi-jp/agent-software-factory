---
type: Convention
title: "フロントエンドのログ出力"
description: "フロントエンドでログを出さないことと、エラー収集の方法を定める規約。フロントエンドで console を使いたくなったとき、クライアントのエラーを集めたいときに読む。"
tags: [logging, convention, frontend]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html
    title: ログ設計ガイドライン
    author: フューチャー株式会社
---

# フロントエンドのログ出力

フロントエンドでは原則ログを出さない。クライアントのエラーを集めるなら Sentry などのログ基盤を使う。
出典は [ログ設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

フロントエンドでは、基本的にログ出力を行わない。

- 開発者向けのデバッグ情報が、一般のユーザーにも見えてしまう可能性があり、情報漏洩のリスクがあるため
- デバッグ用のconsoleが残っていると、コードが読みにくくなるため
- ESLintやBiomeのルールでconsoleの使用は警告されるため、そのルールに合わせる

もし、クライアントのエラー状況などを収集したい場合は、Sentryなどのログ基盤の導入を検討すること。

> [!NOTE]
> **参考**
>
> - [noConsole | Biome](https://biomejs.dev/linter/rules/no-console/)
> - [no-console \- ESLint \- Pluggable JavaScript Linter](https://eslint.org/docs/latest/rules/no-console)
