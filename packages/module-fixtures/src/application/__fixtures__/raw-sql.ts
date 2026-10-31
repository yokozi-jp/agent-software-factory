// Detection-power fixture (#43) of `raw-sql` in lint-restrictions.json (docs/adr/0029): each export below is one that
// no-restricted-imports must report in packages/*/src/application. A line below a disable comment is one that the
// rule must report: if the rule is turned off, drops the value, or its `files` stop reaching this file, the comment
// is unused and `vp check` fails (reportUnusedDisableDirectives). A line of the table with no comment above is one
// that the rule must let through: if it stops it, `vp check` fails. repo-policy checks that every line here is a row
// of the table, and every row a line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing
// imports this file.
// The package does not declare kysely, so each export does not resolve, and the @ts-expect-error says so.
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: raw SQL that skips the types of the builder
export { sql } from "kysely";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: a compiled query that skips the types of the builder
export { CompiledQuery } from "kysely";
