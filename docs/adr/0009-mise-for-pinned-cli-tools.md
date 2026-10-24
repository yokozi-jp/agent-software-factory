---
type: ADR
title: "ADR 0009: 版を固定する CLI ツールは mise と mise.lock で入れる"
description: betterleaks と shellcheck を mise の mise.toml と mise.lock で固定して入れ、mise は CLI ツールの install だけに使う決定。版を固定した CLI ツールを足すとき、mise の設定を変えるときに読む。
tags: [adr, tooling, mise, security]
---

# ADR 0009: 版を固定する CLI ツールは mise と mise.lock で入れる

betterleaks ([ADR 0003](0003-pin-betterleaks-v1.md)) と shellcheck ([ADR 0008](0008-pin-shellcheck.md)) は、版を書いたファイル、GitHub Releases から取る CI の step と sha256、docs の手順、version gate を道具ごとに手で書いていて、版を上げるたびに4か所を変えていました。docs の手順は同じ release の `checksums.txt` と比べるだけなので release の差し替えに気づけず、betterleaks が公開している署名も検証していませんでした。そこで、道具と版を `mise.toml` に書き、checksum を `mise.lock` に記録し、開発者は `mise install --locked`、CI は `jdx/mise-action` で同じ lock から入れるようにしました。開発環境と CI で同じ `mise.toml` と lockfile を使うのは、mise の docs (Continuous integration) が示す使い方です。

## Considered Options

- **install の手順を自前のスクリプトにまとめる**: mise の aqua backend が持つ install の手順と、checksum、cosign、attestation の検証を作り直すことになります。
- **aqua**: CLI ツールだけを扱うので Nx や Vite+ と役割が重なりませんが、Renovate に専用の manager がありません (2026-10 時点)。

## Consequences

- mise は CLI ツールの install だけに使います。`mise.toml` には `[tools]` の版だけを書き、tasks (Nx の役割、[ADR 0002](0002-nx-orchestrates-vite-plus.md))、環境変数、Node.js と pnpm (Vite+ の `vp env` の役割) は書きません。`[tools]` の版だけのファイルは `mise trust` を必要としません。
- スクリプトは `mise exec --` で道具を呼びます。版は mise が lock のとおりに選ぶので、版を比べる version gate は持たず、mise がないときに検査を飛ばさずに失敗します。
- CI は `MISE_LOCKED=1` で lock にない道具を拒否し、mise-action のキャッシュを使いません。復元したキャッシュは lock と照合されないためです。
- `mise.lock` には `linux-x64` だけを記録します。開発環境は WSL です。ほかの platform で開発する人が来たら、`mise lock --platform` に足します。
- 開発者は mise を、署名された apt リポジトリから入れます。
- 版の自動更新は Renovate が行います ([ADR 0016](0016-renovate-for-pinned-versions.md))。
