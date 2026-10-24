---
type: Convention
title: "WebフロントエンドのURLパス設計"
description: "各画面の URL パスをリソース中心で設計する原則と、クエリパラメータの扱いを定める文書。画面の URL を設計するとき、検索条件を URL に持たせるときに読む。"
tags: [web-frontend, convention, url, rest]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forWebFrontend/web_frontend_guidelines.html
    title: Webフロントエンド設計ガイドライン
    author: フューチャー株式会社
---

# WebフロントエンドのURLパス設計

URL パスはリソース中心で設計し、URL はケバブケース、パラメータはローワーキャメルケースを使う。
検索条件はクエリパラメータに設定し、ID トークンやセッション ID はパス・クエリに含めない。
出典は [Webフロントエンド設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

各画面のURLパスは、リソース中心の設計（対象の画面が操作するリソースを意識した設計）を推奨する。REST API との親和性が高く、エンドユーザーに視認性・判読性の高い URL を提供できる。

具体的なパスの設計例は下表の通り。リソースベースのパスに加えて、そのリソースに対するアクション（例. 新規作成:new 更新:edit 承認:confirm）をパスで表現する。

| 画面種別                 | パス構成                      |
| :----------------------- | :---------------------------- |
| ホーム画面               | `/`                           |
| ログイン画面             | `/login`                      |
| 一覧画面                 | `/orders`                     |
| 詳細画面（新規作成）     | `/orders/new`                 |
| 詳細画面（参照）         | `/orders/{order_id}`          |
| 詳細画面（編集）         | `/orders/{order_id}/edit`     |
| 詳細画面（承認）         | `/orders/{order_id}/confirm`  |
| 一覧画面（親子関係あり） | `/orders/{order_id}/products` |

## パス設計の原則

### パスの基本構成

- リソース中心設計：リソース＝データやサービスを表現し、一意の識別子（URI）を持つ。リソースを表す単語は複数形で表現する
  - ✅️ `/orders/{order_id}`
- コレクションはその項目を階層構造で表現する
  - ❌️ `/customers/order/{order_id}`
  - ✅️ `/customers/{customer_id}/orders/{order_id}`

### 一貫性のある命名規則

- URLはケバブケース、パラメータはローワーキャメルケースを使用する
- URLの末尾にスラッシュは付与しない
- 例
  - ❌️ `/systemOrders`
  - ❌️ `/system_orders`
  - ❌️ `/system-orders/{order_id}`
  - ❌️ `/system-orders/{OrderId}`
  - ✅️ `/system-orders`
  - ✅️ `/system-orders/{orderId}`

### 名詞ベースのURI

- 操作を表す動詞（例: `search`, `get`, `delete`）は避け、リソースを表現する名詞を使用する
- リソース名は、意味が通じる範囲で省略せず、明確に記述する
- 例
  - ❌️ `/orders/search?cond1=xxx&cond2=yyy`
  - ❌️ `/orders/{order_id}/detail`
  - ❌️ `/orders/{order_id}/p`
  - ✅️ `/orders/{order_id}/products`

### 代替URL

- 同じコンテンツを表現する代替URLは原則、禁止とする
- 例
  - 以下のURLが同一の製品ページを示す状態は避ける
    - ❌️ `/product/black-t-shirt`
    - ❌️ `/product?id=1234`

> [!WARNING]
> **IDトークンなどをパスパラメータに含めない**
>
> セキュリティの観点から、セッションIDの代替としてトークンを利用してAPIアクセスする場合も、パスパラメータに含めてはならない。HTTPヘッダーを利用できないか検討する。
>
> **参考**: [アプリケーション固有の「ロジックの脆弱性」を防ぐ開発者のためのセキュリティ観点 \- Speaker Deck](https://speakerdeck.com/flatt_security/apurikesiyongu-you-no-rozitukunocui-ruo-xing-wofang-gukai-fa-zhe-notamenosekiyuriteiguan-dian?slide=37)

<!-- 前の注記と分ける -->

> [!TIP]
> **SEOの考慮**
>
> インターネット公開するサービスでは、SEOの観点から極力無駄な階層を含めず、シンプルで直感的な階層構造にする。
>
> - ✅️ECサイトの例：`/category/subcategory/product-name`
> - ✅️ニュースサイトの例：`/year/month/day/article-title`
>
> ノイズとなり検索エンジンが解釈しづらくなるため、意味を持たない文字列は含めない。
>
> - ❌️悪い例: `https://example.com/r_b57f2c0522378b5f30db33ae88ddf19f`
>
> ただし、これは第三者からアクセス可能な画面が前提であり、秘匿性の高い画面については、セキュリティ上推測困難なURLパスとすることが望ましい。

## クエリパラメータ

- 検索フォームやフィルターの条件は、検索ボタン・適用ボタンが押されるたびにクエリパラメータへ設定する。これにより、URLを通して他の人へ結果を共有できる
- フロントエンドのプログラムから扱うときはURLSearchParamsクラスを使ってパース、更新すること
- 原則、`?value`ではなく `?key=value`を使用する。URLパラメータを使用することでサイト構造が把握しやすくなり、クローリングやインデックス登録に寄与するため
  - ❌️ `/orders/1/product?2`
  - ✅️ `/orders/1/product?product_id=2`
- 同じパラメータは重複させる（過去にあったウェブアプリケーションフレームワークによっては別の形式を使うことがあるが、URLSearchParamsは推奨パターンしか作成できない）
  - ✅️ `/orders/1/product?type=pattern1&type=pattern2`
  - ❌️ `/orders/1/product?type=pattern1,pattern2`
- トラッキングコード、ユーザーに基づく相対的な値（location=nearby、time=last-week）、現在時刻などの一時的なパラメータに内部的にリンクさせない。URLの有効期間の短縮や同一ページに対する重複URLの発生に繋がる可能性がある
  - ❌️ `/orders/1/product?session=452991833`
  - ✅️ `/orders/1/product?location=JP`
- URLに絶えず変化する値（タイムスタンプ等）の属性値は含めない
  - 例: タイムスタンプにより`/about?now=12:34am`と`/about?now=12:35am`の場合、表示対象が同じページでも異なるURLとして扱われる可能性がある

> [!WARNING]
> **セッションIDをパラメータに含めない**
>
> セッションIDをURLパラメータに格納していると、ブラウザの Referer 送信によってURLがリンク先のサイトへ送信される。セッション・ハイジャックの懸念があるため、Cookieの利用を検討する。
