# Architecture Decision Records

- [ADR 0001: Git hook は Vite+ の hook ではなく lefthook で管理する](0001-lefthook-for-git-hooks.md)：Git hook を追加、変更するとき、`vp create` や `vp migrate` を実行するとき
- [ADR 0002: タスクの実行は Nx が担当し、Vite+ はツールチェーンとしてだけ使う](0002-nx-orchestrates-vite-plus.md)：タスク、Nx のプラグイン、`vite.config.ts` を追加、変更するとき
- [ADR 0003: betterleaks は v2 ではなく安定版の 1.9.0 に固定する](0003-pin-betterleaks-v1.md)：betterleaks のバージョンや設定を変えるとき
- [ADR 0004: PR は squash merge だけにし、PR タイトルを Conventional Commits で検証する](0004-squash-merge-and-pr-title-lint.md)：merge の方式やコミットの検証を変えるとき
- [ADR 0005: docs を IWE で管理し、OKF v0.2 のバンドルにする](0005-manage-docs-with-iwe-okf.md)：docs の構成、frontmatter、IWE の設定を変えるとき
- [ADR 0006: IWE の書き換え操作を使わず、Markdown の書式は oxfmt に任せる](0006-no-iwe-rewrites.md)：IWE で文書を編集、移動しようとするとき
