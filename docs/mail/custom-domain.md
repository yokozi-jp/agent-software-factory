---
type: Convention
title: "独自ドメイン利用時の注意とメールヘッダー"
description: "メール送信サービスで独自ドメインを使うときの DMARC アライメントの注意と、受信メールのヘッダーからの認証結果の読み方を定める規約。独自ドメインで送信するとき、認証結果を確かめるときに読む。"
tags: [mail, convention, dmarc, mail-header]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forMail/mail_guidelines.html
    title: メール設計ガイドライン
    author: フューチャー株式会社
---

# 独自ドメイン利用時の注意とメールヘッダー

独自ドメインで送るときは、メール送信サービスが提供するドメイン認証設定を必ず使い、DMARC アライメントを成功させる。
`Authentication-Results` などのヘッダーから、SPF・DKIM・DMARC の認証結果を確認できる。
出典は [メール設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 独自ドメイン利用時の注意

Amazon SESなどのメール送信サービスでは、SPF/DKIMがサービス側で設定されるため、利用者が特別な設定を行わずとも認証を通過するメールが配送されることがある。ただし、それらの認証はメール送信サービス側のドメインに対して行われるため、独自ドメインを用いてメールを送信する場合、DMARCアライメントが失敗してしまう。この場合、Gmailなど一部のメールクライアントでは「[amazonses.com](http://amazonses.com) 経由」のような表示がなされたり、迷惑メールとして扱われる・受信拒否されたりする。

推奨は以下の通り。

- 独自ドメイン利用時は、メール送信サービスが提供するドメイン認証設定を必ず利用する。ほとんどのメール送信サービスでは、サービス側が提示するレコードをDNSに登録することで、独自ドメインを用いてドメイン認証を行える（=DMARCアライメントが成功する）仕組みが提供されている

> [!TIP]
> **メールヘッダーとの対応**
>
> 上記ドメイン認証の設定が完了している状態で配信されたメールには、以下のようなヘッダーが記載されている（関係がある項目のみを抜粋）
>
> ```sh
> Return-Path: <envelope@mail.example.com>
> Received-SPF: pass (mx.example.org: domain of envelope@mail.example.com designates 192.0.2.0 as permitted sender) client-ip=192.0.2.0;
> Authentication-Results: mx.example.org;
>        dkim=pass header.i=@example.com header.s=selector header.b="xxxxxxxx";
>        spf=pass (example.org: domain of envelope@mail.example.com designates 192.0.2.0 as permitted sender) smtp.mailfrom=envelope@mail.example.com;
>        dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=example.com
> DKIM-Signature: v=1; a=rsa-sha256; q=dns/txt; c=relaxed/simple; s=selector; d=example.com; t=1753843200; h=From:To:Subject:Message-ID:Date:MIME-Version:Content-Type; bh=xxxxxxxx; b=xxxxxxxx
> From: "送信者表示名" <sender@example.com>
> ```
>
> `Authentication-Results`ヘッダーからドメイン認証結果を確認できる。詳細な記法は受信サーバーにより異なるが、基本的には`dkim=pass`のように、認証の名称と結果が合わせて記載されている。結果が`pass`である場合のみ認証が成功しており、それ以外の場合は失敗しているか、そもそも認証が行われていない。上記の例では、すべて`pass`となっているため、すべてのドメイン認証が成功しており、なりすましの可能性は低いと判断できる。
>
> `dmarc=pass`は、`header.from`のドメイン (example.com) に対し、SPFまたはDKIMの認証ドメインがアライメント（一致）チェックをパスしたことを示す。この例では、DKIMの認証ドメイン (example.com) が`header.from`のドメインと一致しているため、DKIMアライメントに成功している。
>
> SPFに関連するヘッダーは`Return-Path`・`Received-SPF`の2つであり、この2項目からSPF認証がどのように行われたのかがわかる。`Return-Path`には、メールが正常に配信できなかった場合にエラーが返送される宛先である、エンベロープFROMと呼ばれるメールアドレスが記載されている。前述の通り、SPFではこのエンベロープFROMのドメインを用いて認証が行われる（このヘッダーは受信サーバーにより自動的に記録される）。`Received-SPF`には、SPF認証の結果と、認証に用いたエンベロープFROMのメールアドレス、送信元のIPアドレスが記録されている。
>
> DKIMに関連するヘッダーは`DKIM-Signature`である。複数のタグにより構成されており、送信サーバーの設定した値が記録されている。`d`タグにDKIM認証で用いるドメイン、`s`タグにセレクタが記録されており、`h`タグには署名対象のフィールドが記録されている。
>
> ドメイン認証の失敗によるメールの未達が課題となっている場合、上記ヘッダー項目を確認し、想定とは異なる設定となっていないか確認すると良い。
