---
type: Convention
title: "Webフロントエンドのブラウザ機能の採用方針"
description: "Web Platform Baseline を基準に、どのブラウザ機能 (API) を採用するかを定める文書。新しい HTML/CSS/JS の機能を使うか判断するときに読む。"
tags: [web-frontend, convention, browser, baseline]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forWebFrontend/web_frontend_guidelines.html
    title: Webフロントエンド設計ガイドライン
    author: フューチャー株式会社
---

# Webフロントエンドのブラウザ機能の採用方針

ブラウザ機能の採用は Baseline を基準にし、`Widely available` は利用可、`Limited availability` は本番で見送る。
`Newly available` は Experimental でなくフォールバックが用意できるなど総合判断で採用する。
出典は [Webフロントエンド設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

Web 開発は、ブラウザという共通のプラットフォーム上で動作するアプリケーションを構築する点に特徴がある。しかし、ブラウザの種類やバージョンは多岐にわたり、それぞれがサポートする API (機能) に差異がある。この差異を無視して開発を進めると、特定のブラウザでしか動作しない、あるいは意図した動作をしない Web アプリケーションが生まれかねない。そのため、どのようなAPIを利用するかの基本方針を決めておく必要がある。

[Web Platform Baseline](https://developer.mozilla.org/ja/docs/Glossary/Baseline/Compatibility)（以下、Baseline）は、Webプラットフォームの機能（**web-features**）のブラウザ間の相互運用性（**Interoperability**）を示す指標である。Web 開発におけるある機能に対して、ブラウザのサポート状況を明確にすることを目的としている。

対象となるブラウザは以下である。

- Chrome (デスクトップ、Android)
- Edge (デスクトップ)
- Firefox (デスクトップ、Android)
- Safari (デスクトップ、iOS)

Baseline は、機能のサポート状況に応じて、以下の3つの区分に分けられる。

- `Widely available` (広く利用可能な機能)
  - 主要なブラウザで利用可能になってから30ヶ月以上経過し
  - 安心して利用できる安定した機能セットとみなされる
- `Newly available` (新たに利用可能になった機能)
  - 主要なブラウザで利用可能になってから30ヶ月以内の機能
  - 最新安定版のブラウザやデバイスで動作が保証されるが、古いブラウザでは動作しない可能性がある
- `Limited availability` （制限付き利用可能）
  - 対象ブラウザの内一部でのみ利用可能な状態で、Baselineに乗っていないとされる
  - 実験的な機能や、将来的に仕様が変更される可能性のある機能

また、上記とは別に `Newly available` `Limited availability` には、以下の条件の1つ以上が該当する場合に[Experimental](https://developer.mozilla.org/ja/docs/MDN/Writing_guidelines/Experimental_deprecated_obsolete#%E5%AE%9F%E9%A8%93%E7%9A%84) というマークが付く。

- レンダリングエンジンの有効な実装が1つだけ
- 環境設定やフラグなどの設定変更によってのみ対応する
- 定義している仕様が、後方互換性のない方法で大幅に変更される可能性がある

一般的に、サポート対象のブラウザベンダーやバージョンを絞っている場合でも、Baselineに準拠した機能選定は重要な意味を持つ。理由は以下の通り。

- **長期的な安定性・保守性**: 標準に基づいて実装することで、将来のブラウザアップデートやWeb標準の変化に対してより耐性の高いコードベースを維持できる。特にエンタープライズ向けの開発で求められる
- **一貫した動作の保証**: 社内ポリシーやセキュリティ要件により特定機能が制限される環境でも一貫した動作を保証し、予期せぬ互換性問題のリスクを軽減できる
- **チーム内の共通理解**: 開発チーム内での共通理解を促進し、コードの一貫性と品質向上も期待できる

推奨は下表の通り。

| #                      | 機能の採用方針                                                                                                                                                                                                                                                                                                    |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Widely available`     | ✅️利用可。余裕があればフォールバックも実装できるとベター                                                                                                                                                                                                                                                          |
| `Newly available`      | ⚠️総合的に判断して採用する。判断基準の例としては次の通り。 ・Experimentalではない ・システムにおいて重要なロジックが、その機能に依存していない ・フォールバックが用意できる ・プロジェクトでサポートするブラウザの最新安定版で動作が保証されている ・ユーザーが積極的にブラウザのバージョンを更新する見込みがある |
| `Limited availability` | ❌️本番環境での採用は見送った方がよい                                                                                                                                                                                                                                                                              |

より簡易的な方針としては以下を推奨する。

- `Widely available` とExperimentalではない `Newly available` の機能は原則、利用可
- Experimentalである `Newly available` と `Limited availability` の機能は原則、利用不可
- Experimentalである `Newly available` のうち、フォールバック手段が存在するなどでリスクが低く、利用することで開発生産性や保守性が高く向上すると見込まれる場合のみ、アーキチームと導入について個別相談する

【Baselineステータスから判断OKとした例 （※作成日: 2025/02/21）】

| #          | （1）[`<dialog>` 要素](https://developer.mozilla.org/ja/docs/Web/HTML/Element/dialog)                                                     | （2）[:has()](https://developer.mozilla.org/ja/docs/Web/CSS/:has)                                                                                                                                              |
| :--------- | :---------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 画像       | （画面: MDN の `<dialog>` 要素ページのヘッダー。Baseline が緑色の「Widely available」で、Chrome・Edge・Firefox・Safari すべて対応を示す） | （画面: MDN の `:has()` ページのヘッダー。Baseline が青色の「2023 NEWLY AVAILABLE」で、Chrome・Edge・Firefox・Safari すべて対応を示す）                                                                        |
| ステータス | `Widely available`                                                                                                                        | `Newly available`                                                                                                                                                                                              |
| 説明       | `Widely available` であり多くのブラウザサポートあり                                                                                       | `Widely available` で無いが、主要ブラウザで幅広くサポートあり。                                                                                                                                                |
| 判断例     | ✅️採用OK                                                                                                                                  | ✅️`:has()` 関数が登場するまではJS頼りになっていた親要素の状態に基づくスタイリングをCSSのみで実現でき、宣言的な実装が可能となり、性能向上、保守性の改善に繋がる。本ガイドラインとしては採用しても良いと判断する |

【Baselineステータスから判断NGとした例 （※作成日: 2025/02/21）】

| #          | （3）[popover属性](https://developer.mozilla.org/ja/docs/Web/HTML/Global_attributes/popover)                                                                                  | （4）[abs() 関数（CSS）](https://developer.mozilla.org/ja/docs/Web/CSS/abs)                                                                             |
| :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 画像       | （画面: MDN の popover 属性ページのヘッダー。Baseline が「2025 NEWLY AVAILABLE」で 4 ブラウザ対応だが、フラスコ印の「Experimental: これは実験的な機能です」という注記が付く） | （画面: MDN の CSS `abs()` 関数ページのヘッダー。Baseline が橙色の「Limited availability」で、Chrome・Edge は非対応 (×)、Firefox・Safari は対応を示す） |
| ステータス | `Newly available` かつExperimental                                                                                                                                            | `Limited availability`                                                                                                                                  |
| 説明       | 有用な機能であり、主要ブラウザで幅広くサポートされている。しかし、Experimentalマークが付いているため、PoCレベルではプロジェクト毎の判断で良いが、本番での採用は非推奨         | FirefoxとSafariでのみサポート                                                                                                                           |
| 判断例     | ❌️Experimentalであるため本番での採用は非推奨                                                                                                                                  | ❌️採用NG                                                                                                                                                |

> [!TIP]
> **Baselineの確認方法**
>
> [mdn web docs](https://developer.mozilla.org/ja/docs/Web): Mozilla社がホストしているOSSのドキュメント。先述のケーススタディで使用した画像はこのドキュメントからの引用。
> 「この機能のBaselineのステータスはどうなっているのか？」をざっくり確認したい場合に役立つ。
>
> [Can I use…](https://caniuse.com/): Can I use はWebプラットフォーム上の機能のInteroperabilityの状況を、ブラウザの「種類 x バージョン」のマトリックスで確認できるWebサービス。以下は FaviconのSVGサポート状況をCan I useで確認した2025年3月時点の例である。SafariでSVG形式のFaviconを使用できる時期は遠そうだと見て取れる。
>
> （画面: Can I use で「SVG Favicon」を検索した結果。SVG favicons の各ブラウザ×バージョンの対応状況マトリクスを示し、グローバル利用率は 77.63%、Safari では対応が遅れていることが読み取れる）
>
> [Web Platform Status Dashboard](https://webstatus.dev/): 主要なブラウザベンダーが提供するWebプラットフォームの機能やAPI実装状況を一覧化したツール。Chrome、Edge、Firefox、Safariなど各ブラウザでの対応状況や標準化の進捗を視覚的に確認でき、クロスブラウザ対応の計画を立てる際の重要な情報源となる。加えて、実験的機能や将来実装予定の機能についても知ることができるため、最新のWeb技術動向を把握するのに役立つ。
>
> （画面: Web Platform Status Dashboard の Baseline 2025 の一覧。contenteditable="plaintext-only"、Intl.DurationFormat、Popover、Promise.try() の 4 機能について、Baseline 状況と Chrome・Edge・Firefox・Safari の対応、WPT スコアを表で示す）

<!-- 前の注記と分ける -->

> [!NOTE]
> **参考**
>
> - [Baseline](https://web.dev/baseline?hl=ja)
> - [Baseline (互換性) \- MDN Web Docs 用語集: ウェブ関連用語の定義](https://developer.mozilla.org/ja/docs/Glossary/Baseline/Compatibility)
