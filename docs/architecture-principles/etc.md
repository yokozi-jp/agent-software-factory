---
type: Convention
title: "実装の指針: ETC (Easier To Change)"
description: "「良い設計は変更しやすい」というETCの価値観と、データモデルやコードへの適用例を説く文書。設計の良し悪しを変更容易性で判断するときに読む。"
tags: [architecture-principles, convention, implementation, etc]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forPrinciple/principle_guidelines.html
    title: アーキテクチャ原則ガイドライン
    author: フューチャー株式会社
---

# 実装の指針: ETC (Easier To Change)

ETCは「良い設計は悪い設計よりも変更しやすい」という、良い設計を判断する価値観を提供する原則である。
変化の激しい現代では、間違いや変化が判明したときに速やかに低コストで修正できるかが、システムの寿命を左右する。
出典は [アーキテクチャ原則ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## ETC（Easier To Change）

ETCとは『[達人プログラマー: 熟達に向けたあなたの旅](https://www.amazon.co.jp/%E9%81%94%E4%BA%BA%E3%83%97%E3%83%AD%E3%82%B0%E3%83%A9%E3%83%9E%E3%83%BC-%E7%AC%AC2%E7%89%88-%E7%86%9F%E9%81%94%E3%81%AB%E5%90%91%E3%81%91%E3%81%9F%E3%81%82%E3%81%AA%E3%81%9F%E3%81%AE%E6%97%85-David-Thomas/dp/4274226298)』で提唱された、システムの変更が容易になるように設計せよという原則である。「良い設計は悪い設計よりも変更しやすい」という、良い設計を判断する価値観を提供する。変化の激しい現代では「今持っている情報は、明日には間違っているかもしれない」ことが多々ある。だからこそ「間違いや変化が判明したときに、いかに速やかに、低コストで修正できるか」というETCの観点はシステムの寿命を大きく左右する。

ETCの考え方は、アーキテクチャやコードだけでなく、エンジニアリングプロセスのあらゆる場面に適用できる。

> [!NOTE]
> **例1: データモデルにおけるETC（正規化 / ERD）**
>
> 正規化することによって仕様変更に対する影響範囲を最小化できる。
>
> ```mermaid
> graph TD
> subgraph "非正規化"
>   direction TB
>   Spec1([ブランド属性の追加])
>   Spec1 -- "定義追加・移行" --> T1[商品テーブル]
>   Spec1 -- "定義追加・移行" --> T2[在庫テーブル]
>   Spec1 -- "定義追加・移行" --> T3[売上テーブル]
>   Note1[3つのDDLが必要]
> end
>
> subgraph "正規化"
>   direction TB
>   Spec2([ブランド属性の追加])
>   Spec2 -- "定義追加のみ" --> P[商品テーブル]
>   P --- Inv[在庫テーブル]
>   P --- Sal[売上テーブル]
>   Note2[1つのDDL変更だけで、<br/>関連テーブルは参照により恩恵を受ける]
> end
> ```

<!-- 前の注記と分ける -->

> [!NOTE]
> **例2: ソースコードにおけるETC**
>
> 先述の正しいDRYとして、1つの知識は一箇所に実装することで、修正漏れを防ぎ変更を容易にする。
>
> ```mermaid
> graph TD
> subgraph "冗長なコード"
>   Dev1((👨‍💻開発者)) -- "修正" --> FuncA["機能A (税率10%)"]
>   Dev1 -- "修正" --> FuncB["機能B (税率10%)"]
>   Dev1 -- "修正" --> FuncC["機能C (税率10%)"]
> end
>
> subgraph "DRY"
>   Dev2((👨‍💻開発者)) -- "修正" --> Lib["共通税率Lib (10%)"]
>   Lib --> ModA[機能A]
>   Lib --> ModB[機能B]
>   Lib --> ModC[機能C]
> end
> ```
