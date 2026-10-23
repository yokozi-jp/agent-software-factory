# Agent instructions

## Docs

Conventions, runbooks, and ADRs live in `docs/`. Start at `docs/index.md`; each line says when to read that area. Read `docs/adr/index.md` before adding or changing a tool, plugin, or task runner.

## Recommendations

When you recommend a tool, layout, or setting, say whether it is the standard practice, name the source of that standard (official docs, the tool's template or defaults), and name the anti-pattern it avoids. Mark your own judgement as judgement.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `yokozi-jp/hono-nx-vite-plus`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use the default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
