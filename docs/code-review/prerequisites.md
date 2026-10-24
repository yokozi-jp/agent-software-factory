---
type: Convention
title: "コードレビューの前提条件"
description: "コードレビューを始める前に整えておくブランチ戦略、GitHub 設定、CI、プルリクエストテンプレート、開発規約を定める文書。レビュー運用を立ち上げるとき、CI やブランチ保護を設定するときに読む。"
tags: [code-review, convention, ci, git]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forCodeReview/code_review.html
    title: コードレビューガイドライン
    author: フューチャー株式会社
---

# コードレビューの前提条件

全ての機能開発や不具合修正は、`feature` ブランチを使ったプルリクエストを経由してマージする。
機械的なチェックは CI に寄せ、チームで合意した開発規約を遵守しつつ育てることを前提とする。
出典は [コードレビューガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 前提条件

### 利用するGitブランチ戦略

このリポジトリはトランクベース開発 ([ADR 0010](../adr/0010-trunk-based-development.md)) を利用している。

そのため、全ての機能開発や不具合修正は、`main` から切った短命なブランチを使用したプルリクエストを経由して、squash merge で `main` にマージする ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))。`develop` などの永続ブランチは無い。

### 事前設定（GitHub）

`main` は ruleset (`.github/rulesets/protect-main.json`) で保護している ([GitHub リポジトリの設定](../repository/github-settings.md))。できるかぎり自動化やテンプレートを用意して個々人が考慮すべきことを減らし、運用負荷を下げて規則を形骸化させず実効性を上げることを基本姿勢とする。

| 設定項目                                                                                                                                            | このリポジトリ                    | 説明                                                                                                                      |
| :-------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| Require a pull request before merging                                                                                                               | ✔ (squash merge だけ)             | プルリクエストを必須とする                                                                                                |
| Require approvals                                                                                                                                   | 0                                 | 承認の数は必須にしていない。人が読む PR は [agent の PR のレビュー](agent-pull-requests.md#人が判断するもの) で決めている |
| Require status checks to pass before merging                                                                                                        | ✔ (main、commitlint、betterleaks) | CIの成功をマージ条件とする                                                                                                |
| [CODEOWNERS](https://docs.github.com/ja/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) | 未設定                            | 重要ファイル（例えば、ddl.sqlやopenapi.yamlなど）は承認が必須なレビュアーを指定する                                       |
| [linguist-generated=true](https://docs.github.com/ja/repositories/working-with-files/managing-files/customizing-how-changed-files-appear-on-github) | 未設定                            | ツールなどによる生成ファイルの差分を非表示にする .gitattributesの設定                                                     |

### 機械的なチェックが可能な場合はCIに寄せる方針としている

コードレビューのやり取りで、「コードフォーマットされていない」 「リンターを通していない」といった指摘は不毛である。そのため、CIでそれらを実行し、パスしているという前提条件を作ることが重要である。これにより、レビュアーは人間が本来見るべき点に集中できる。

例えば、下表のような内容はフォーマッターやリンターに寄せられる可能性が高い。

| 自動化可能だと考えられる指摘例         | ツール例                                                                                                             |
| :------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| 使われていないメソッドや関数           | Pythonの場合、Flake8 など                                                                                            |
| デッドコード                           | Pythonの場合、Vultureなど                                                                                            |
| デバッグ用のログの残骸                 | JS/TS は `vp lint` (Oxlint の `no-console`。このリポジトリでは `apps/web/src` で error)。 Pythonの場合は、Pylintなど |
| 不適切なレイヤーに対するimport         | Pythonの場合、import-linterなど                                                                                      |
| //TODO コメントが残っている            | JSでは、eslint-plugin-no-inline-commentsなど                                                                         |
| フォーマッターが適用されているかどうか | JS/TS は `vp fmt --check`、Pythonでは `black --check yourfile.py` など                                               |

### CIによるレビューコメント連携を行う

Linterなどの検知結果をreviewdogなどと連携することで、形式的な指摘はツール側に寄せる。それにより開発者個々人のやり取りを減らし、本当に集中すべき事項に時間を割くこととする。

### プルリクエストテンプレートでチェックリストを設ける

プルリクエストにチェックリストを追加し、レビュー依頼前にセルフチェックする運用を採用するチームも多い。チェックリストが多すぎると形骸化するため、項目は具体的にする（例: 設計ドキュメントを同時に直したか？ など）とともに、必要最低限の項目に留め、チームの成熟度に応じて適時見直す運用とする。

> [!NOTE]
> **参考**
>
> [リポジトリ用のプルリクエストテンプレートの作成 \- GitHub Docs](https://docs.github.com/ja/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository)

### チームで合意した開発規約が存在し遵守しつつ育てる

以下のような、チームで守るべきと合意形成されたコーディング規約や命名ルールが存在し、これらの内容をチームで改善し続ける運用であることを前提とする。

- [Javaコーディング規約](https://future-architect.github.io/coding-standards/documents/forJava/Java%E3%82%B3%E3%83%BC%E3%83%87%E3%82%A3%E3%83%B3%E3%82%B0%E8%A6%8F%E7%B4%84.html)
- [SQLコーディング規約](https://future-architect.github.io/coding-standards/documents/forSQL/SQL%E3%82%B3%E3%83%BC%E3%83%87%E3%82%A3%E3%83%B3%E3%82%B0%E8%A6%8F%E7%B4%84%EF%BC%88PostgreSQL%EF%BC%89.html)
- [AWSインフラ命名規約](https://future-architect.github.io/coding-standards/documents/forAWSResource/AWS%E3%82%A4%E3%83%B3%E3%83%95%E3%83%A9%E3%83%AA%E3%82%BD%E3%83%BC%E3%82%B9%E5%91%BD%E5%90%8D%E8%A6%8F%E7%B4%84.html)
- [OpenAPI Specification 3.0.3規約](https://future-architect.github.io/coding-standards/documents/forOpenAPISpecification/OpenAPI_Specification_3.0.3.html)
