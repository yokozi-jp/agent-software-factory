---
inclusion: fileMatch
fileMatchPattern:
  [
    ".github/**",
    "lefthook.yml",
    "mise.toml",
    "**/vite.config.ts",
    "tools/scripts/**",
    "scripts/**",
    ".betterleaks.toml",
    "pnpm-workspace.yaml",
  ]
name: tooling
description: CI の workflow、Git hook、mise、Vite+、スクリプト、secret scan、pnpm の設定を作成または編集するときに、どの docs の規約を読むかを示す。
---

# 開発ツール

CI の workflow、Git hook、mise、Vite+、スクリプト、secret scan、pnpm の設定を作成、編集するときは、`docs/tooling/index.md` を読む。コマンド、CI、hook、Renovate などの文書への入口がある。
