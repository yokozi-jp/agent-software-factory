# Agent instructions

## Docs

Conventions, runbooks, and ADRs live in `docs/`. Start at `docs/index.md`; each line says when to read that area. Read `docs/adr/index.md` before adding or changing a tool, plugin, or task runner.

`docs/` は過去の調査の cache で、古くなっていることがある。作業する前に、今の一次情報 (仕様、公式ドキュメント) と、今のデファクトスタンダード、ベストプラクティス、アンチパターンを調べる。取り込んだガイドライン (`about.md` がある領域) は 2023〜2025 年に書かれている。一次情報と docs が食い違ったら一次情報に従い、同じ変更で docs を直す。取り込んだ領域なら、その `about.md` の「原文からの変更点」に書く。合意した範囲の外の修正になるなら、直さずに報告する。

## Recommendations

When you recommend a tool, layout, or setting, say whether it is the standard practice, name the source of that standard (official docs, the tool's template or defaults), and name the anti-pattern it avoids. Mark your own judgement as judgement.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `yokozi-jp/agent-software-factory`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use the default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
