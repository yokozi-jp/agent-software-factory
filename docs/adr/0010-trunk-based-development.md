---
type: ADR
title: "ADR 0010: ブランチ運用はトランクベース開発にし、main と短命なブランチだけを使う"
description: 長く続くブランチを main だけにし、変更は main から切った短命なブランチの PR で入れる決定と、ブランチの寿命と名前の決まり。ブランチを作るとき、ブランチ運用やリリースの流れを変えるとき、取り込んだガイドラインが develop や release ブランチを前提にしているときに読む。
tags: [adr, repository, git, branch, trunk-based-development]
---

# ADR 0010: ブランチ運用はトランクベース開発にし、main と短命なブランチだけを使う

このリポジトリでは、人と coding agent が並行して小さな変更を次々に入れ、`main` からリリースします ([リリース](../repository/release.md))。`develop`、`release`、`hotfix` を持つ git-flow や GitLab Flow の形にすると、永続ブランチどうしのマージと、どのブランチがどの環境に対応するかの管理が増えます。そこで、長く続くブランチは `main` だけにし、変更は `main` から切った短命なブランチで行い、PR の squash merge で `main` に戻すトランクベース開発にしました。レビューを通る短命なブランチは、[trunkbaseddevelopment.com の Short-Lived Feature Branches](https://trunkbaseddevelopment.com/short-lived-feature-branches/) が示すトランクベース開発の形の1つです。

## ルール

- 長く続くブランチは `main` だけです。`develop`、`release`、`hotfix` などの永続ブランチは作りません。不具合の修正も、他の変更と同じ短命なブランチで入れます。
- ブランチは `main` から切り、PR で squash merge して消します ([ADR 0004](0004-squash-merge-and-pr-title-lint.md))。`main` への直接の push は ruleset が拒否します ([GitHub リポジトリの設定](../repository/github-settings.md))。
- ブランチは2日以内に merge するのを目安にします。長くなりそうな変更は、小さな PR に分けます。未完成の機能は、ブランチに溜めず、外から呼ばれない形で `main` に入れます。
- 1本のブランチを書くのは1人です (その人が動かす coding agent を含みます)。並行して作業するときは、ブランチと worktree を分けます ([並行作業と worktree](../tooling/worktrees.md))。
- ブランチ名は `<type>/<短い説明>` にします。`<type>` は Conventional Commits の type (`feat`、`fix`、`docs`、`ci`、`build` など、[コミットと PR の規約](../repository/commit-conventions.md)) か、調査だけのブランチの `research` です。

## Considered Options

- **GitLab Flow や Lite GitLab Flow** (取り込んだ arch-guidelines の Git ブランチフローガイドラインが推奨する形): `develop` と `main` の2本の永続ブランチを同期させる手間が増えます。このリポジトリには、`develop` で検証してから本番に出す環境の段がありません。そのため、このガイドラインは取り込んでいません。
- **main への直接のコミット** (トランクベース開発のもう1つの形): PR のチェック (CI、commitlint、betterleaks) とレビューを通さずに `main` が変わります。
