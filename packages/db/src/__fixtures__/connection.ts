// Detection-power fixture (#43) of `connection` in lint-restrictions.json (docs/adr/0029, docs/adr/0038): the import
// below is one that the override of packages/db/src must let through: db opens the connections. A line below a
// disable comment is one that the rule must report: if the rule is turned off, drops the value, or its `files` stop
// reaching this file, the comment is unused and `vp check` fails (reportUnusedDisableDirectives). A line of the table
// with no comment above is one that the rule must let through: if it stops it, `vp check` fails. repo-policy checks
// that every line here is a row of the table, and every row a line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip
// __fixtures__/, and nothing imports this file.
import "pg";
