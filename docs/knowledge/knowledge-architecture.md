---
type: Architecture
title: AGENTS.md、steering、docs、IWE の役割分担
description: エージェント向けの知識を AGENTS.md、steering、docs、IWE のどこに置くかと、それらの間の依存の向き。知識をどこに書くか迷ったとき、steering や AGENTS.md を追加、変更するときに読む。
tags: [knowledge, architecture, agents, steering, iwe]
---

# AGENTS.md、steering、docs、IWE の役割分担

規約、手順、設計の正文は `docs/` に置きます。
`AGENTS.md` と steering は、`docs/` のどこを読むかを示すナビゲーションだけを持ちます。
依存は AGENTS.md と steering から docs への一方向です。

## 役割

| 置き場所          | 役割                                                                   | 読み込まれ方                                          |
| ----------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `AGENTS.md`       | リポジトリの入口。`docs/index.md` と、skill 用の設定へのポインタ       | 全てのセッションで常に読み込まれる                    |
| `.kiro/steering/` | 領域ごとの入口。どの作業のときに、どの `docs/<領域>/index.md` を読むか | 常に読み込まれる (Kiro CLI では fileMatch が効かない) |
| `docs/`           | 規約、手順、設計、ADR の正文。OKF v0.2 バンドル                        | ポインタをたどって、必要な文書だけを読む              |
| IWE               | `docs/` の検索、リンクの追跡、OKF の検査 (CLI `iwe`、MCP `iwec`)       | 必要なときに呼ぶ                                      |

## 依存の向き

- AGENTS.md と steering から `docs/` へは、パスを文字列で示します。本文を展開しません。
- `docs/` から AGENTS.md や steering を参照しません。
- 規約文書には今のルールと検査方法を書き、理由は ADR にリンクします。

## steering を作るとき

steering は常に読み込まれ、毎回コンテキストを使います。ナビゲーションに限り、規約の本文は書きません。
steering の書き方の規約 (`docs/knowledge/steering-authoring.md`) は、最初の steering を作るときに作ります。

## 見つからないとき

1. 該当する `index.md` の行がなければ、IWE の全文検索 (`iwe_find`、`pnpm exec iwe find`) で探します。
2. それでも見つからなければ、推測で進めずに利用者に確認します。
3. 作業で判明した規約や知識は、`docs/` への追加を提案します。
