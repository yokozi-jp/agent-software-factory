<!--
PR タイトルは Conventional Commits で書く (例: `feat(api): ユーザー登録 API を追加`)。
squash merge でタイトルが main のコミットになり、リリースのバージョンと CHANGELOG に使われる。
破壊的変更はタイトルの type の後に `!` を付ける (例: `feat(api)!: ...`)。
この本文も squash コミットの本文になるので、使わない節とコメントは消してから出す。
-->

## Summary

<!-- 変更の要点を、図・diff・ツリー・疑似コードのうち一番小さいもので示す。文章は短く。 -->

## Evidence

<!-- 動くことの証拠。UI の変更はスクリーンショット、それ以外はテストやコマンドの出力。 -->

- **Before:**
- **After:**

## Merge Danger

**Door:** <!-- two-way (簡単に戻せる) / one-way (戻せない: データ移行、公開 API の変更、削除など) -->

**Blast Radius:** <!-- 影響範囲を一語で (例: api のみ、web の表示、全体の CI) -->

<!-- 関連 Issue があれば書く。merge 時に自動で close される。 -->

Closes #
