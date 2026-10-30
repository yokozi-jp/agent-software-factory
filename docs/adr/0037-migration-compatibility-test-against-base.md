---
type: ADR
title: "ADR 0037: migration の更新の試験は、PR の base の版のアプリの結合テストを、PR の migration を適用した DB で流す"
description: 切り戻し先の前の版のアプリが、PR の migration を適用した後のスキーマで動くことを、ci.yml の必須の job で確かめる決定。前の版は PR の base の commit で代用し、git worktree に出した base の結合テストを coverage なしで全部流す。順序は base の migration、seed、PR が足した migration。すべての PR で起動し、migration に差分がなければ成功で終える。base の migration の書き換えと削除は DB の起動前に失敗させる。例外のラベルは作らない。比べた案はビルド済みのイメージ、PR 側の harness と base のテストの混在、検証環境。migration を足す、直すとき、更新の試験の job や harness を実装する、変えるとき、更新の試験が失敗したとき、例外で通したくなったとき、前の版を base からリリースのタグに替えるときに読む。
tags: [adr, ci, db, migration, testing, expand-contract]
---

# ADR 0037: migration の更新の試験は、PR の base の版のアプリの結合テストを、PR の migration を適用した DB で流す

PR の migration を適用した DB に、切り戻し先の前の版のアプリの結合テストを流す job を、`ci.yml` の必須チェックに足します。前の版は PR の base の commit (main の先端) で代用します。実装は [更新の試験の job と harness の段を実装する](https://github.com/yokozi-jp/agent-software-factory/issues/302) で行い、経緯は [migration が前の版のアプリと両立するかを確かめる更新の試験の流し方を決める](https://github.com/yokozi-jp/agent-software-factory/issues/213) にあります。

## 背景

DB のロールバックはなく、障害はアプリを前の版に戻して直します ([ADR 0025](0025-kysely-and-dbmate-sql-first.md))。そのため、互換を壊す変更を expand と contract に分ける約束 ([Parallel Change](https://martinfowler.com/bliki/ParallelChange.html)) が守られていないと、切り戻し先のアプリが新しいスキーマで動かず、戻す手段がなくなります。この約束を守っているかは、これまでレビューでしか見ていませんでした。

空の DB に migration を流す検査 ([ADR 0025](0025-kysely-and-dbmate-sql-first.md)) と、毎回空の DB から作る検証環境 ([検証環境で migration をどこから、いつ当てるかを決める](https://github.com/yokozi-jp/agent-software-factory/issues/203)) は、前の版のアプリとの組み合わせも、既存の行への効き方も確かめません。

## ルール

- **目的**: 切り戻し先の前の版のアプリが、PR の migration を適用した後のスキーマで動くことを確かめます。新しいアプリと古いスキーマの組み合わせは試験しません。DB を戻さないので、起きるのは前の版のアプリと新しいスキーマの組み合わせだけです。
- **前の版**: PR の base の commit で代用します。本番の CD ができたら、リリースのタグに替えます ([ソフトウェアファクトリーへの地図](https://github.com/yokozi-jp/agent-software-factory/issues/23) の「時期が来たら」に書いてあります)。
- **場所とゲート**: `ci.yml` の新しい job で、GitHub Actions の runner 上の testcontainers の PostgreSQL を使います。`nx` の job と同じく Docker が使えます。job は `main` の `needs` に入れて必須にします ([CI](../tooling/ci.md))。
- **対象**: job はすべての PR で起動し、`packages/db/migrations/**` に差分がなければ成功で終えます。path filter と Nx の affected は使いません。path filter で workflow を skip すると必須チェックが pending のまま merge を止め、条件で skip した job は成功として扱われます ([GitHub Docs: Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks))。job の中で差分を見て成功で終えれば、どちらにも当たりません。
- **既存の migration**: base にある migration の書き換えと削除があれば、DB を起動する前に失敗させます。適用済みの migration は書き換えない約束 ([ADR 0025](0025-kysely-and-dbmate-sql-first.md)) を、ここで機械的に止めます。
- **流し方**: base を `git worktree` に出し、その版の結合テスト (`apps/api` の Vitest の `integration` project) を全部流します。coverage は有効にしません。有効にすると、`perFile` の下限が古い版の数字で効き、`autoUpdate` が `vite.config.ts` を書き換えるためです ([CI](../tooling/ci.md#coverage-の下限))。harness (結合テストの前に DB を用意する段取り。今は `apps/api/test/global-setup.ts`) は、base の migration、seed、PR が足した migration の順に流します。段取りは `tools/scripts` の TypeScript で書き、Vitest で試します ([ADR 0024](0024-scripts-and-hooks-in-typescript.md))。
- **seed**: この試験専用の seed は作りません。リポジトリ共通の seed を、base のスキーマに base の seed を流す形で使います。方式は [seed の方式を決める](https://github.com/yokozi-jp/agent-software-factory/issues/300) で決めました。
- **例外**: ラベルは作りません。緊急のときは ruleset の bypass で人が通します ([GitHub リポジトリの設定](../repository/github-settings.md))。
- **最初の PR**: base に seed の入口がなければ、`::notice::` を出して成功で終えます。
- **テストの境界**: 差分の分類と skip の判定は純粋な関数の `rules.test.ts`、入口は sandbox の git と stub の `cli.test.ts` で試します。検出力は、base のアプリが使う列を消す試験用の PR で job が失敗することを、一度だけ手で確かめ、実施の PR の本文に記録します。

## Considered Options

- **ビルド済みのイメージで流す**: 前の版のイメージを作る本番の CD がまだありません。イメージを使っても、前の版の結合テストを流すにはそのテストのソースが別に要るので、base の commit を出すより手順が減りません (判断)。
- **PR 側の harness と base のテストファイルを混ぜる**: base のテストは base の harness とセットで書かれています。PR が harness を変えると base のテストが動かなくなり、その失敗を migration の非互換と区別できません (判断)。
- **検証環境で流す**: 検証環境は毎回空の DB から作るので、既存の行への効き方を確かめられません ([検証環境で migration をどこから、いつ当てるかを決める](https://github.com/yokozi-jp/agent-software-factory/issues/203))。

## Consequences

- migration を足す PR は、merge の前に前の版の結合テストが通る必要があります。expand と contract を 1 つの PR にまとめると、この job が止めます。
- 例外は ruleset の bypass だけです。contract の段の migration のように止まるはずの PR は、base のアプリが contract の対象を使わなくなってから出します。
- migration の置き場所は、[migration と DB の道具を packages/db に移し、依存の向きを検査する](https://github.com/yokozi-jp/agent-software-factory/issues/337) で移るかもしれません。移ったら、対象のパスをその場所に読み替え、この ADR も直します。
- 結合テストを 2 つの版で流すので、migration を含む PR の CI は長くなります。job の実行時間 (`pnpm install` と PostgreSQL の起動を含む) は確かめていません。実施の Issue で測り、長ければ絞ります。
- seed は、表や列を変える migration と同じ PR で書き換える決まりです ([seed の方式を決める](https://github.com/yokozi-jp/agent-software-factory/issues/300))。base の worktree には base の seed があるので、PR が seed を書き換えても、base のスキーマに流す seed は base のものです。
