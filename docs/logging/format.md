---
type: Convention
title: "ログのフォーマット"
description: "ログを JSON Lines で出すことと、ローカル環境だけの例外を定める規約。ロガーの出力形式を決めるとき、ローカルで色や絵文字を使いたいときに読む。"
tags: [logging, convention, json-lines]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html
    title: ログ設計ガイドライン
    author: フューチャー株式会社
---

# ログのフォーマット

ログは JSON Lines で出す。ローカル環境だけは非構造のログも許す。
ANSI エスケープシーケンスは原則使わない。
出典は [ログ設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

ログのフォーマットには構造化ログであるJSON Linesを利用する。

- RFC 8259で仕様が標準化されており、数値型や真偽値などのデータ型が利用できるため。幅広く利用されているため、CloudWatch LogsやBigQuery等の多くのサービスやツールでサポートされているため。
- Apache Combined FormatやLTSV（Labeled Tab-Separated Values）は信頼できる仕様が存在しない。
- OpenTelemetry Protocol(OTLP)のデータをJSON形式で表現したOTLP/JSONは採用しない。
  - OTLP/JSONは深くネストされた複雑な構造を持っており、視認性やログ分析性が下がるため。

## ローカル環境の場合

ローカル環境に限っては、JSON Linesではなく非構造なログ形式も許容する（構造化ロギングのままでも良い）。

> [!TIP]
> **絵文字でカラフルに**
>
> 特にローカル環境のターミナルでしか利用しない場合は、ログメッセージに絵文字を入れると視認性が向上しやすいというテクニックがある。
>
> ```console
> DEBUG: Order #ORD-123 の処理を開始します。現在のステータス: PENDING ⏳
> DEBUG: 在庫を確認中... 商品ID: P-123 の在庫は 10個です ✅
> DEBUG: 注文ステータスを PROCESSING ⚙️ に更新しました。
> DEBUG: 最終的な合計金額を計算しました: 💰 10000円
> DEBUG: ユーザー customer@example.com 宛に確認メールを送信します 📧
> DEBUG: 注文ステータスを COMPLETED ✨ に更新しました。
> DEBUG: Order #ORD-123 の処理が正常に完了しました 🎉
> ```
>
> 適切な絵文字を使うことで、ログメッセージの見逃しを防げる。デバッグ中の心理的な負担を抑制できるという声もある。ただし、あくまで開発環境限定とし、デプロイメント環境ではこういった絵文字は出さない（ノイズとなるため）ようにすること。

<!-- 前の注記と分ける -->

> [!TIP]
> **ANSIエスケープシーケンスでターミナルを彩る**
>
> モダンなロギングライブラリが普及する前は、ANSIエスケープシーケンスと呼ばれる特殊な文字列をログに埋め込むことで、ターミナルのログ出力に色を付けて視認性を高めるテクニックが使われることもあった。
>
> - \\u001B\[31m: 赤色
> - \\u001B\[33m: 黄色
> - \\u001B\[32m: 緑色
> - \\u001B\[0m: 装飾をリセット
>
> ```java
> // Javaでの出力例
> System.out.println("\u001B[31m" + "ERROR" + "\u001B[0m" + ": Critical failure detected.");
> System.out.println("\u001B[33m" + "WARN" + "\u001B[0m" + ": API response is slow.");
> ```
>
> ANSIエスケープのよくある課題は、ANSIエスケープシーケンスを解釈できない環境では、ただのノイズの多い文字列として表示されてしまうことである。例えばログをファイルにリダイレクト（\>）して後からテキストエディタで開いたり、CI/CDツールのログビューアで表示したりすると、以下のようにシーケンスがそのまま表示され、視認性が低下する。
>
> ```shell
> # 制御シーケンスが表示されたログの例
> ^[[31mERROR^[[0m: Critical failure detected.
> ^[[33mWARN^[[0m: API response is slow.
> ```
>
> そのため、高性能なロギングライブラリ（Logback, Log4j2など）では、出力先が色表示に対応したターミナル（TTY）であるかを自動的に判別し、対応している場合のみ安全に色を付けるといった機能を持つものがある。
>
> 便利な場面もあるが、クラウド環境ではパースの負荷がかかるだけであり、エスケープミスなどの事故も多いため、原則、ANSIエスケープは利用しない。
