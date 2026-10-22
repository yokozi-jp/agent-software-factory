---
type: ADR
title: "ADR 0005: docs を IWE で管理し、OKF v0.2 のバンドルにする"
description: docs/ を IWE で管理する OKF v0.2 バンドルにし、frontmatter と index.md の構成を CI で検査する決定と、生成された IWE の設定を削った理由。
tags: [adr, documentation, iwe, okf]
---

# ADR 0005: docs を IWE で管理し、OKF v0.2 のバンドルにする

エージェントが必要な文書だけを選んで読めるように、`docs/` を IWE で管理する OKF v0.2 のバンドルにしました。全ての文書に frontmatter (`type`、`title`、`description`、`tags`) を付け、領域ごとの `index.md` から「いつ読むか」を添えてリンクします。`iwe schema validate`、リンク切れ、孤立文書を、pre-commit hook と CI で検査します。文書が約10件の今のうちに入れておく方が、後から全件に frontmatter を付けるより安く済みます。

## Considered Options

- **IWE を検索とリンクの追跡だけに使い、frontmatter を付けない**: 文書の種類で絞り込めず、孤立文書やスキーマの違反を機械的に検出できません。
- **長い ADR 形式 (`ADR-NNN-slug.md`、Status から References までの7つの節) に変える**: `domain-modeling` と `grill-with-docs` skill が前提とする ADR-FORMAT.md から外れ、skill を使うたびに書き方がずれるので、ADR-FORMAT.md の形式に frontmatter だけを足しました。

## Consequences

- `docs/.iwe/schemas/okf.yaml` は、`iwe init --okf` が生成した版より厳しくしています。4項目を必須にし、`type` を `Convention`、`Architecture`、`Runbook`、`Reference`、`Domain`、`ADR` の6種類に限りました。語彙を限らないと、`type` で絞り込むときに表記が揺れます。
- `docs/.iwe/config.toml` からは、生成された AI アクション、`[commands.default]` (`claude -p`)、書き換えるアクション (`extract`、`inline` など) を削りました。`claude -p` は Claude Code の CLI で、Kiro を使うこのリポジトリでは動きません。書き換えるアクションは [ADR 0006](0006-no-iwe-rewrites.md) で使わないと決めた操作です。必要になったら `iwe init --defaults` の出力から戻せます。
- IWE は devDependency (`@iwe-org/iwe`、catalog で固定) で入れ、`pnpm exec` で呼びます。グローバルに入っている iwe は他のリポジトリ用なので使いません。
