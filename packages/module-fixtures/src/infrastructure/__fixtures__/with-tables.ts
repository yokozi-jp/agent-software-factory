// Detection-power fixture (#43) of `with-tables` in lint-restrictions.json (docs/adr/0029): the call below is one
// that the rule must let through in packages/*/src/infrastructure, where the public API function reads its own tables
// with the transaction of the caller. A line below a disable comment is one that the rule must report: if the rule is
// turned off, drops the value, or its `files` stop reaching this file, the comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). A line of the table with no comment above is one that the rule must let through:
// if it stops it, `vp check` fails. repo-policy checks that every line here is a row of the table, and every row a
// line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing imports this file.
declare const trx: { withTables(): unknown };

export const tables = trx.withTables();
