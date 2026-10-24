# Architecture Decision Records

- [ADR 0001: Git hook は Vite+ の hook ではなく lefthook で管理する](0001-lefthook-for-git-hooks.md)：Git hook を追加、変更するとき、`vp create` や `vp migrate` を実行するとき
- [ADR 0002: タスクの実行は Nx が担当し、Vite+ はツールチェーンとしてだけ使う](0002-nx-orchestrates-vite-plus.md)：タスク、Nx のプラグイン、`vite.config.ts` を追加、変更するとき
- [ADR 0003: betterleaks は v2 ではなく安定版の 1.9.0 に固定する](0003-pin-betterleaks-v1.md)：betterleaks のバージョンや設定を変えるとき
- [ADR 0004: PR は squash merge だけにし、PR タイトルを Conventional Commits で検証する](0004-squash-merge-and-pr-title-lint.md)：merge の方式やコミットの検証を変えるとき
- [ADR 0005: docs を IWE で管理し、OKF v0.2 のバンドルにする](0005-manage-docs-with-iwe-okf.md)：docs の構成、frontmatter、IWE の設定を変えるとき
- [ADR 0006: IWE の書き換え操作を使わず、Markdown の書式は oxfmt に任せる](0006-no-iwe-rewrites.md)：IWE で文書を編集、移動しようとするとき
- [ADR 0007: API のランタイムは Bun に移行せず Node.js のままにし、アプリのコードは Web 標準の API だけで書く](0007-api-on-node-web-standard-app.md)：API のランタイムやデプロイ先を変えるとき、`apps/api` に入口のファイルを足すとき、Node.js や Bun 固有の API を使いたくなったとき
- [ADR 0008: シェルスクリプトは版を固定した shellcheck で検査する](0008-pin-shellcheck.md)：シェルスクリプトを足すとき、shellcheck の版や検査の対象を変えるとき
- [ADR 0009: 版を固定する CLI ツールは mise と mise.lock で入れる](0009-mise-for-pinned-cli-tools.md)：版を固定した CLI ツールを足すとき、`mise.toml` や `mise.lock`、mise の設定を変えるとき
- [ADR 0010: ブランチ運用はトランクベース開発にし、main と短命なブランチだけを使う](0010-trunk-based-development.md)：ブランチを作るとき、ブランチ運用やリリースの流れを変えるとき、取り込んだガイドラインが develop や release ブランチを前提にしているとき
- [ADR 0011: テナントが1つでも、tenant_id と PostgreSQL の RLS を最初から入れる](0011-tenant-id-and-rls-from-the-start.md)：表や migration を足すとき、DB のロールや接続の設定を変えるとき、テナントを使わない構成に戻したくなったとき、DB を PostgreSQL 以外にしたくなったとき
- [ADR 0012: GitHub Actions の workflow は版を固定した actionlint と zizmor で検査する](0012-lint-workflows.md)：workflow を足す、変えるとき、workflow の検査や actionlint、zizmor の版を変えるとき、検査の指摘を抑制したくなったとき
- [ADR 0014: 手書きのソースの重複は jscpd で検査し、導入時の重複率を閾値にする](0014-jscpd-duplication-threshold.md)：重複の検査で止まったとき、検査の対象や閾値、jscpd の版や設定を変えるとき、意図した重複を残したくなったとき
