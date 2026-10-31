---
type: Convention
title: "ログのセキュリティ"
description: "ログに出してはいけない情報、ログのアクセス制御、ユーザー向けメッセージとの分離を定める規約。ログに出す値を決めるとき、ログの保管先の権限を設定するときに読む。"
tags: [logging, convention, security, pii]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html
    title: ログ設計ガイドライン
    author: フューチャー株式会社
---

# ログのセキュリティ

機密情報や個人情報はログに出さず、必要ならマスキングする。ログは改ざんできない権限にし、閲覧者を絞る。
出典は [ログ設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

推奨は以下の通り。

- 機密情報をログ出力しない。どうしても必要な場合はマスキングする
  - セッションID、アクセストークン、パスワード、APIキー、クレジットカード番号、個人情報（PII）、ユーザーが収集に同意していない情報（GDPR）
    - 誤って出力されないように、ログ出力のフレームワーク側でもマスキングやオミットするような作り込みを行っておく
    - 機密フィールドを除外した、JavaでいうtoString()メソッドやDTO（構造体など）を作っておく
- アクセス制御
  - ログの不正な改ざんを防ぐため、一度書き込まれたら変更、削除できないようなIAMロール設定を行う
  - 閲覧制御も、必要なメンバーのみに絞るようにする
- ユーザー向けログと開発者向けログは分離する
  - スタックトレースや、外部API、DBの出力するエラーメッセージ（`SQLException: Connection refused for user 'root'@'db-host-internal'`）などは攻撃のヒントになるため
  - ユーザー向けの画面メッセージは、ユーザーフレンドリーな内容を表示し、開発者向けの詳細な内容はログに表示する方針とする

## このリポジトリでのマスク

機密情報の漏れは、三層で防ぐ ([ADR 0049](../adr/0049-logging-with-pino-behind-a-logger-interface.md))。

1. **発生源で載せない**: 呼び出し側が渡せるキーは `LogFields` の型にあるものだけで、秘匿情報になるキーはそこにない。例外は `exceptionFields()` を通し、型、メッセージ、スタックトレースだけを出す。pg のエラーの `detail`、`where`、`parameters` は行の値を含むので読まない。`user.id` と `tenant_id` は UUID で、秘匿しない。
2. **ロガーの `redact`**: pino の `redact` で、最上位と 1 段下の秘匿キー (`password`、`token`、`authorization`、`cookie`、`set-cookie`、`detail`、`where`、`parameters` など) を `[REDACTED]` にする。型を迂回して渡された値の、最後の防御。`message` の文字列に混ぜた値、綴りの違うキー、2 段より深い入れ子は守れない。守れないことは `packages/logging/src/node.test.ts` に書いてある。
3. **保存先**: CloudWatch Logs のデータ保護で、保存先でもマスクする。AWS の上の設定と確認はデプロイの実施で行う。
