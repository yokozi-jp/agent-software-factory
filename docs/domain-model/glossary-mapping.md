---
type: Reference
title: 英語の識別子と用語集の対応表
description: domain と application の英語の識別子と、GLOSSARY.md の日本語の言葉の対応表の雛形。識別子は DB の列、URL、OpenAPI、library と揃えて英語にする。識別子を決めるとき、用語集の言葉を英語にするとき、対応表に行を足すときに読む。
tags: [domain-model, reference, glossary]
---

# 英語の識別子と用語集の対応表

`domain` と `application` の識別子は英語にします。DB の列、URL、OpenAPI、library の名前と揃うためです ([ADR 0027](../adr/0027-domain-model-as-pure-functions-and-unions.md)、判断)。日本語の言葉の定義は [GLOSSARY.md](../../GLOSSARY.md) が正で、ここには実装の詳細を書きません。

## 使い方

- 用語集に言葉を足したら、同じ変更でこの表に行を足します。
- 識別子は 1 つの言葉に 1 つだけです。別名を作りません。
- 識別子が決まっていない言葉は「未定」とし、サンプル機能の仕様を書くときに決めます。
- モデルの中身 (状態の粒度、集約の境界) はここでは決めません。

## 対応表

| GLOSSARY.md の言葉 | 識別子     | 備考                                                                                |
| ------------------ | ---------- | ----------------------------------------------------------------------------------- |
| 申請 (モジュール)  | `claim`    | `packages/claim`                                                                    |
| 承認 (モジュール)  | `approval` | `packages/approval`                                                                 |
| 締め (モジュール)  | `closing`  | `packages/closing`                                                                  |
| テナント           | `tenant`   | DB の列は `tenant_id` ([ADR 0011](../adr/0011-tenant-id-and-rls-from-the-start.md)) |
| 経費精算           | 未定       |                                                                                     |
| 申請 (業務)        | 未定       |                                                                                     |
| 明細               | 未定       |                                                                                     |
| 申請者             | 未定       |                                                                                     |
| 上長               | 未定       |                                                                                     |
| 経理               | 未定       |                                                                                     |
| 承認 (業務)        | 未定       |                                                                                     |
| 確認               | 未定       |                                                                                     |
| 差戻し             | 未定       |                                                                                     |
| 取下げ             | 未定       |                                                                                     |
| 締め (業務)        | 未定       |                                                                                     |
