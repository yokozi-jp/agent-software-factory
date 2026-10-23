---
type: Convention
title: "今後追記予定の項目"
description: "表示制御、保存要件、性能、セキュリティ、ドキュメント、テストについて、原文で今後追記予定 (TBD) となっている項目を示す文書。これらの領域で原文の検討状況を確かめるときに読む。"
tags: [report, convention, todo]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forReport/report_guidelines.html
    title: 帳票設計ガイドライン
    author: フューチャー株式会社
---

# 今後追記予定の項目

表示制御、保存要件、性能、セキュリティ、ドキュメント、テストは、原文で追記予定 (TBD) の項目として挙げられている。
出典は [帳票設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 表示制御

TBD 1,000（カンマ有無）、右寄せ/左寄せ、ルビ、0埋め有無、マイナス表示（-△▲1,000）などを追記予定。

## 保存要件

TBD 法定基準。電子帳票（電帳法の要件）、印刷帳票の保管場所など留意事項を追記予定。

## 性能

TBD 以下を追記予定。

- 電子帳票: 非同期化・並列化
- 紙帳票: サーバー性能（スプールファイル作成）、サーバー→プリンタへのネットワーク帯域、プリンタの印刷性能（PPM）、レイアウトによる印刷スピード、センター大量印刷時のPDF/直接制御について触れる

## セキュリティ

TBD 以下を追記予定。

- 電子帳票: [PDFの印刷許可/不許可設定](https://helpx.adobe.com/jp/acrobat/desktop/protect-documents/protect-with-passwords/restrict-printing-editing-and-copying-pdfs.html)
- 紙帳票: プリンタ認証。金券扱いになるなどで再印刷は不許可（上長承認必須など）、この場合はPDF印刷不可にしたり、【再印刷】というラベルを追加したりする

## ドキュメント

TBD 帳票一覧（種別、用紙種別、業務担当者、利用先などの記載すべき項目）/帳票設計書について追記予定。

## テスト

TBD 全体テスト計画に準ずる。紙帳票固有の事情としては、単体テストで印字テストをしておくべきで、STなど後続フェーズにできる限り回すべきではない旨を追記予定。
