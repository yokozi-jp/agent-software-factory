---
type: Convention
title: "coding agent が書いたプルリクエストのレビュー"
description: "coding agent が書いたプルリクエストを、ゲート、agent のレビュー、人の判断に分けてレビューする決まり。承認の数を必須にしない運用で、人がどの PR をどこまで見るかを定める。agent の PR をレビューするとき、マージするとき、レビューの役割を変えるときに読む。"
tags: [code-review, convention, coding-agent, reviewer]
---

# coding agent が書いたプルリクエストのレビュー

このリポジトリでは、coding agent が Issue からプルリクエストまでを書き、人は仕様と判断に集中する。
そのため、この領域の他の文書が前提にしている「レビュイーは、コードを理解して書いた人」は成り立たない。
agent の PR は、機械で判定できるものをゲートで止め、agent のレビューで指摘を出し、人は仕様どおりかと変更の範囲を判断する。
この文書は原文にはなく、このリポジトリで足した。GitHub の [Review AI-generated code](https://docs.github.com/en/copilot/tutorials/review-ai-generated-code) が挙げる確認点を、次の3つに振り分けている。

## ゲートで止めるもの

次のものは、人が見る前に CI と Git hook のゲートで止まる。人はこれらを目で確かめなくてよい。

| 確認点                                                                | このリポジトリのセンサー                                                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ビルドとテストが通り、新しい警告がない                                | CI の `nx affected -t check test build`。`vp check` は警告も失敗にする (`denyWarnings`、[ADR 0020](../adr/0020-typescript-strictness.md))                             |
| 存在しない API を呼んでいない                                         | `vp check` の型チェック (tsgolint)                                                                                                                                    |
| 型エラーを `any`、`!`、絞り込みの `as`、`@ts-ignore` で黙らせていない | Oxlint の `typescript/no-explicit-any`、`no-non-null-assertion`、`no-unsafe-type-assertion`、`ban-ts-comment` など ([ADR 0020](../adr/0020-typescript-strictness.md)) |
| テストを直さずにスキップした、一部だけを実行するようにした            | Oxlint の `vitest/no-disabled-tests` と `vitest/no-focused-tests` (`*.test.ts` と `*.test.tsx`)                                                                       |
| 秘密情報を commit していない                                          | betterleaks (pre-commit、pre-push、CI)                                                                                                                                |
| 公開されたばかりの版の依存を入れていない                              | pnpm の `minimumReleaseAge` (pnpm 11 以降の既定は 1440 分)                                                                                                            |
| コミットと PR のタイトルの形式                                        | commitlint                                                                                                                                                            |

ゲートが止められない誤りを見つけたら、レビューで指摘するだけでなく、ゲートに足せないかを考える。

## agent のレビュー

agent のレビューは、指摘を出すセンサーとして使い、承認にはしない。
このリポジトリでは `code-review` skill が、規約に沿っているか (Standards) と、Issue の仕様どおりか (Spec) の2つの観点でレビューする。
GitHub Copilot code review も、既定ではプルリクエストの必須の承認の数に入らない ([About GitHub Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review))。

## 人が判断するもの

人は、agent の PR のすべての行を読むのではなく、次の点を判断する。

- Issue の仕様と意図どおりか。「正しく見えるが、意図と違う」コードは、ゲートでも agent のレビューでも止まらない
- 変更の範囲が Issue に合っているか。頼んでいないリファクタリングや機能が混じっていないか
- テストが、仕様を確かめているか。実装に合わせて期待値を書き換えただけのテストではないか
- `oxlint-disable` の理由が、その場で安全だと言えるものか。`apps/web/src` は理由の有無を機械で止めるが、それ以外では止まらない ([ADR 0020](../adr/0020-typescript-strictness.md))
- 新しい依存が実在し、保守されていて、ライセンスが合うか

`main` の ruleset は、マージに必要な承認の数を 0 にしている ([GitHub リポジトリの設定](../repository/github-settings.md))。
人は、次のどれかに当たる PR を、マージの前に必ず読む。

- PR の本文の Merge Danger の Door が one-way (データの移行、公開している API の変更、削除など)
- ADR、`AGENTS.md`、`.kiro/` の skill、steering、hook を変える
- `.github/` の workflow と ruleset、`lefthook.yml`、`tools/scripts/` のゲートを変える
- 依存を足す

それ以外の PR は、ゲートが通っていれば、本文の Summary と Evidence を確かめてマージしてよい。
マージは人が行う。

## プルリクエストの粒度

agent は大きな差分を短い時間で書けるが、人が判断できる量は変わらない。
1つの Issue を1つの PR にし、2日以内にマージする ([ADR 0010](../adr/0010-trunk-based-development.md))。
1つの PR に収まらない Issue は、先に Issue を分ける。
