---
type: Convention
title: "メールの表現形式 (形式・HTML・絵文字)"
description: "メール形式 (プレーン・HTML・マルチパート)、HTML メールの実装、絵文字の扱いを定める規約。メールの形式を選ぶとき、HTML メールや絵文字を実装するときに読む。"
tags: [mail, convention, html-email, multipart]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forMail/mail_guidelines.html
    title: メール設計ガイドライン
    author: フューチャー株式会社
---

# メールの表現形式 (形式・HTML・絵文字)

原則、HTML 版とプレーンテキスト版を両方送るマルチパート配信を採る。
HTML メールは保守的な CSS で組み、装飾用 CSS は動かなくても視認性を保てる2段階アプローチにする。
出典は [メール設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## メール形式

メールの形式は、歴史的背景から主に3つの種類がある。

- **プレーンテキストメール**
  - RFC 822（現[RFC 5322](https://tex2e.github.io/rfc-translater/html/rfc5322.html)）などで定義された、文字情報のみで構成される形式で、文字の装飾や画像の挿入が不可
  - 視覚的な訴求力は低いが、あらゆる環境で表示できる強みがある
- **リッチテキストメール**
  - Microsoft社のOutlookなどが独自に採用していた形式
  - 太字や色付けなどの装飾が可能だが、特定のメールソフトでしか正しく表示されない制約がある
- **HTMLメール**
  - HTMLとCSSを使って構成される形式
  - セキュリティにより画像表示をOFFにしている端末や、HTMLメールをサポートしないフィーチャーフォン（ガラケー）などでは、表示崩れなどによる可読性低下のリスクがある

使い分けについては以下の案が考えられる。

| \#     | （1）プレーンテキストメールのみを送信する                      | （2）HTMLメールのみを送信する        | （3）マルチパート配信                                                              |
| :----- | :------------------------------------------------------------- | :----------------------------------- | :--------------------------------------------------------------------------------- |
| 説明   | 全てのメールを、互換性が最も高いプレーンテキスト形式で送信する | 全てのメールをHTML形式のみで送信する | HTML版とプレーンテキスト版の両方をマルチパートで送信し、受信側が最適な方を選択する |
| 確実性 | ✅どの環境でも表示される                                       | ⚠️HTML非対応環境では読めないリスク   | ✅必ずどちらかが表示される                                                         |
| 表現力 | ❌ 文字情報のみで、訴求力が弱い                                | ✅視覚的な訴求力が高い               | ✅HTML版では高い                                                                   |

推奨は以下の通り。

- 原則、（3）を選択する
  - 大多数のユーザーにはHTMLメールの表現力を利用でき、フィーチャーフォンなどごく一部のユーザーにも最低限の伝達を保証できるため
  - マルチパート配信は、SendGridやAmazon SESといった主要なESPが標準機能としてサポートしており、HTML・プレーンテキストの2つのコンテンツを用意するだけで良いため

## HTMLメール

HTMLメールは豊かな表現力を持ちエンゲージメントを高めるために有効だが、Webページとは全く異なり、特有の知識と対応が求められる。HTMLメールの代表的な課題は、レンダリングエンジンの断片化である。HTMLとCSSを解釈・表示するエンジンがメールクライアントごとにバラバラで、しかもその多くは古い。ブラウザの世界では、標準技術への対応が進んでいるが、メールクライアントでは「断片化」がまだまだ残っており、表示崩れや意図しない表示の原因となっている。

近年、HTMLメール開発において最も注目すべき動きは、Microsoft社によるOutlookのレンダリングエンジンの刷新である。

- [New Outlook for Windows available to all Insiders](https://techcommunity.microsoft.com/blog/microsoft365insiderblog/new-outlook-for-windows-available-to-all-insiders/4216122)

しかし、多くの企業や買い切り版Officeでは、依然としてMicrosoft Wordをベースとした旧来の「クラシックOutlook」が利用され続けている。そのため、2025年現在は新旧のOutlookが混在する移行期であると推測される。[Email Client Market Share and Popularity \- Litmus](https://www.litmus.com/email-client-market-share) によれば、2025年7月時点で、Outlookのシェアは7％である。新旧の比率は不明であるが、相当数が存在するであろうクラシック版のサポートを切り捨てる判断は、難しいと考えられる。

主要サービスのHTML・CSSサポート概況を下表にまとめる。

| \#                          | レンダリングエンジン   | 説明                                                                                                        |
| :-------------------------- | :--------------------- | :---------------------------------------------------------------------------------------------------------- |
| Outlook（旧デスクトップ版） | Microsoft Wordベース   | CSSのサポートが弱く、背景画像や角丸・Flexbox/Gridといったモダンなレイアウトの利用不可                       |
| Outlook（新デスクトップ版） | Edge（WebView2）ベース | モダンなHTML/CSSのサポートが向上                                                                            |
| Gmail                       | 独自                   | 比較的新しいCSSにも対応しているが、`<style>`タグの一部を削除したり、独自の解釈あり。CSSのインライン化が有効 |
| Apple Mail (iPhone/Mac)     | WebKit（Safariと同じ） | 最も標準に準拠し、最新のHTML/CSSにも対応している                                                            |
| キャリアメール              | 独自                   | 基本的なHTMLタグしかサポートしない場合が多い。複雑なレイアウトは表示が崩れる前提で考えるべき                |

推奨は以下の通り。

- 原則、レイアウトは保守的なCSSで組み、装飾用のCSSは動かなくても視認性を保てる、2段階アプローチを採用する
- 1段階目のCSSは、以下の実装ルールに則る
  - レイアウトは `<table\>` タグで組む
    - `<div\>` タグやFlexbox/Gridによるレイアウトは多くのクライアントで崩れるため。近年、一部のモダンなクライアントでは`<div>`タグやFlexboxを用いたレイアウトのサポートが向上しており、「テーブルレイアウトは不要」とする意見もある。しかし旧バージョンのOutlookなどの表示互換性の確保を優先する
  - CSSをインライン化する
    - GmailやOutlookは、`<style>`タグで定義したCSSを削除したり、正しく解釈しないことがある。そのため、HTMLタグのstyle属性に記述する「インライン化」が安全である
  - Webフォント（@font-face）サポートは少数派であるため、Arial, Helvetica, メイリオ, ヒラギノ角ゴといった、OSに標準でインストールされている「システムフォント」を利用する
  - 画像の代替テキスト（alt属性）は必ず設定する
- 2段階目のCSSは以下のルールで組む
  - `<style>` タグにしか書けないCSSは、消される前提とする
    - 例えば角丸やWebフォントは追加装飾扱いとする
  - レスポンシブデザインに対応
    - メールの半数以上はスマートフォンで開封されるため、メディアクエリ（@media）を用いたレスポンシブデザインとする。しかし、一部のアプリでは機能しないため、あくまで追加の装飾として実装する
  - ダークモード対応
    - @media (prefers-color-scheme: dark) というCSSを使い、背景色や文字色をダークモード用に最適化する
  - メールの本文テンプレートごとに、主要な環境で表示崩れが起きていないかを、送信前に必ず確認する

> [!WARNING]
> **Gmailの102KB制限**
>
> メールの容量が102KBを超える場合、受信者側でメール本文が省略されて表示され、本文の途中で［メッセージ全体を表示］というリンクが表示される。ユーザーごとに表示件数が可変である場合、この制約に引っかからないように上限の件数を指定する。特にインラインCSSである場合、容量が思ったより増えてしまうため注意する。

<!-- 前の注記と分ける -->

> [!TIP]
> **HTML、CSSのサポート**
>
> [Can I email… Email Client Support Scoreboard](https://www.caniemail.com/scoreboard/) というサイトで、具体的なHTMLやCSSのサポートを確認できる。2025年7月7日時点では、GmailのサポートがデスクトップのWeb版で25位と、思ったより高くないことが分かる。

<!-- 前の注記と分ける -->

> [!NOTE]
> **参考**
>
> - [HTMLメールの最近の実装方法を解説、tableは不要になりました | コリス](https://coliss.com/articles/build-websites/operation/work/modern-html-email-tables-no-longer-required.html)
> - [CSS サポート | Gmail | Google for Developers](https://developers.google.com/workspace/gmail/design/css?hl=ja)

## 絵文字

メールを装飾しつつ、メールの容量を抑える方法として絵文字の活用もある。エージェントによって見た目が変わる欠点はあるが、スタイルを設定できないsubjectでも色を出して目立たせられるメリットがある。subjectの利用ではオープン率が向上したという調査結果を掲載しているウェブサイトもある([The Ultimate Guide to Emojis in Email](https://taxiforemail.com/blog/the-ultimate-guide-to-emojis-in-email/) や [A Complete Guide to Using Emojis in Emails](https://www.plusvibe.ai/blog/a-complete-guide-to-using-emojis-in-emails))。

- 本文ではほとんどの環境で問題なく利用できるが、絵文字にはバージョンがあり、新しいバージョンの文字は表示されないことがある。特にiOSは9月ごろのOSの新バージョンまで更新されない。メールのエージェントによってはサブセットしかサポートしないケースもありえる
  - [Emoji Version 17.0](https://emojipedia.org/emoji-17.0)
- subjectでの利用はOutlook 2003で行えない(2007はOK)
  - 参考: [Using emojis and symbols in email marketing](https://www.campaignmonitor.com/resources/guides/using-emojis-and-symbols-in-email-marketing/)
- 絵文字は世代や地域、一部のグループなどによって独特の隠語の意味を与えられることがある点に注意すること
  - 参考: [知らずに使ってない？ ドラッグの隠語になっている絵文字 | ギズモード・ジャパン](https://www.gizmodo.jp/2022/08/drug-emoji.html)
- 絵文字がレンダリングされなくても意味が通じるようにすること（文中の単語の代わりに絵文字を使うなどは避ける）
- 可読性が下がるため、使いすぎは避けること
