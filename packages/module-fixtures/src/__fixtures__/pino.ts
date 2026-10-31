// Detection-power fixture (#43) of `pino` in lint-restrictions.json (docs/adr/0049): the import below is one that
// no-restricted-imports must report in packages/*/src: code depends on the Logger of @agent-software-factory/logging,
// and pino is created in packages/logging/src/node.ts. A line below a disable comment is one that the rule must
// report: if the rule is turned off, drops the value, or its `files` stop reaching this file, the comment is unused
// and `vp check` fails (reportUnusedDisableDirectives). A line of the table with no comment above is one that the
// rule must let through: if it stops it, `vp check` fails. repo-policy checks that every line here is a row of the
// table, and every row a line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing imports
// this file.
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: the logger library
import "pino";
