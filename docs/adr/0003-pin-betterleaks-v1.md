---
type: ADR
title: "ADR 0003: betterleaks は v2 ではなく安定版の 1.9.0 に固定する"
description: betterleaks を開発中の v2 ではなく安定版の 1.9.0 に固定し、hook と CI で同じ版と設定を使う決定。
tags: [adr, tooling, betterleaks, security]
---

# ADR 0003: betterleaks は v2 ではなく安定版の 1.9.0 に固定する

betterleaks の `main` ブランチは v2 の開発中で、CLI、設定ファイル、レポートの形式に破壊的変更があります。Homebrew、`go install ...@latest`、Docker の `latest` タグは、時期によって v1 と v2 のどちらが入るかが変わります。開発者ごとにルールや動作が違うと、ローカルで通った commit が CI で落ちる (またはその逆) ことになるので、安定版の 1.9.0 に固定しました。版は `mise.toml` に書き、hook と CI は `mise.lock` に記録した checksum で検証したバイナリを使います ([ADR 0009](0009-mise-for-pinned-cli-tools.md))。`.betterleaks.toml` の `betterleaksMinVersion` も同じ版にして、古い版を拒否します。

## Consequences

- リポジトリ内の設定ファイルを自動で読むかどうかもバージョンで違う (v1.x の docs では `--unsafe-auto-load-config` が必要) ので、hook と CI の両方で `--config .betterleaks.toml` を明示的に渡します。
- 公式の GitHub Action はないので、betterleaks 用の第三者製の Action は使いません。CI は mise で入れます。
- v2 が安定版になったら、この ADR を見直して移行します。
