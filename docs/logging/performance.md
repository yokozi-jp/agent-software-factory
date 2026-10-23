---
type: Convention
title: "ログ出力の性能"
description: "非同期ロギング、遅延評価、ログ出力の分岐、出力量の抑制を定める規約。ロガーを設定するとき、ログ出力が遅さの原因か疑うときに読む。"
tags: [logging, convention, performance, java, go, python]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html
    title: ログ設計ガイドライン
    author: フューチャー株式会社
---

# ログ出力の性能

Java は Logback の AsyncAppender で非同期に出し、メッセージの組み立てはロガーのプレースホルダーに任せる。
ループの中で毎回ログを出さず、ファイル名と行番号はデプロイメント環境で出さない。
出典は [ログ設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

推奨は以下の通り。

- 非同期ロギング
  - Javaでは、 **SLF4J \+ Logback** の組み合わせかつ、AsyncAppender を活用する
  - AsyncAppender は、ログイベントを一旦メモリ上のキューに格納し、別のワーカースレッドがキューからイベントを取り出しログ出力する
  - プロセス障害時のログ欠損に備え、JVMのシャットダウンフックでキュー内のログをフラッシュさせる設定を追加する
  - キューが溢れた時の対応は、アプリケーションをブロッキングさせる。ログを破棄させる設定にはしない
  - Goのロギングは非常にシンプルで性能が良いため、非同期ロギングは利用しなくても良い
- 遅延評価の活用
  - SLF4J利用かつ、付加項目をメッセージに埋め込む場合、プレースホルダー ({}) を使用し、そのログレベルが出力対象でない場合、引数の文字列化などの処理自体をなくす
    - ✅️良い例: `log.debug("Processing user data: {}", userObject);`
    - ❌️悪い例: `log.debug("Processing user data: " + userObject.toString());`
  - Pythonのloggingモジュールを利用する場合、`f`文字列ではなく、％形式のプレースホルダーを使用することで、そのログレベルが出力対象でない場合の引数のレンダリング処理を防ぐ
    - ✅️ 良い例: `logging.debug("Processing user data: %s", user_object)`
    - ❌️ 悪い例: `logging.debug(f"Processing user data: {user_object}")`
  - 構造化ログの場合、アプリケーション側で toString() などを呼び出さず、ロガー側に任せる
    - 本当にログ出力される場合に限り、シリアライズを限定できる
- ログ出力の分岐を書く
  - slf4jなどの場合、 `if (logger.isDebugEnabled()) {...}` などとログレベルに応じて分岐させる。特にログ出力用に文字列加工する場合は必須とする
  - Goのロギングは上記のような慣習が無いため行わなくても良い（構造化ロギングの場合、文字列を生成しないため許容されていると思われる）

注意点は以下の通り。

- forループでのマシンガンログはNG
  - 1000件に1度など、サンプリングしたログ出力を行う
- ファイル名・行番号はログ出力項目にしない
  - ログ項目の「ファイル名」や「行番号」をスタックトレースから取得する処理は負荷が高く、性能劣化の原因になりえる
  - ローカル環境のみ許容し、デプロイメント環境には出力させない。Javaであればロガー名からファイル名の特定は容易であるため
- アプリケーション側での性能問題の疑いがある場合、ログ出力を疑ってみる
  - 特にSQLログなどを大量に出力している場合、そこが遅い場合もある

> [!TIP]
> **logback.xml の設定例**
>
> AsyncAppenderの設定例を示す。
>
> ```xml
> <configuration>
>   <appender name="JSON_STDOUT" class="ch.qos.logback.core.ConsoleAppender">
>     <encoder class="net.logstash.logback.encoder.LogstashEncoder" />
>   </appender>
>   <appender name="ASYNC_JSON_STDOUT" class="ch.qos.logback.classic.AsyncAppender">
>     <discardingThreshold>0</discardingThreshold>
>     <queueSize>256</queueSize>
>     <appender-ref ref="JSON_STDOUT" />
>   </appender>
>   <root level="INFO">
>     <appender-ref ref="ASYNC_JSON_STDOUT" />
>   </root>
> </configuration>
> ```

<!-- 前の注記と分ける -->

> [!TIP]
> **エラー時のバッファリングに注意**
>
> アプリケーションプロセスがクラッシュするような致命的なエラー（FATALレベルなど）が発生した場合、最後に記録しようとしたログメッセージを失うことがある。これは性能向上のためにログ出力内容をメモリ上にバッファすることで生じる。これは原因特定の手がかりが欠損するため、よく問題になる。
>
> この問題を回避するため、「エラーログは即座に書き出す（フラッシュする）べき」という考え方が昔から語られてきた。具体的には、標準エラー出力（stderr）は、標準出力（stdout）と異なり、多くの環境で行バッファリング（改行ごとに書き出し）やバッファリングなしで動作するため、エラーログの出力先として推奨されてきた経緯がある。Goのslogでは明示的にbufio.Writerなどを利用しない限りはバッファリングしないが、そうではない言語では注意が必要である。
>
> Javaのロギングライブラリ（Logback, Log4j2など）では、特定のログレベル（例: WARN以上）のログが記録された際に、自動的にバッファをフラッシュする設定が可能であるため、設定を確認すると良い。
>
> 設定例 (Logback)
>
> ```xml
> <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
>     <encoder>
>         <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
>     </encoder>
>     <immediateFlush>true</immediateFlush>
> </appender>
> ```
>
> ※注: ConsoleAppenderのimmediateFlushはデフォルトでtrueである。ここでは説明のためにあえて明示的に記載している
