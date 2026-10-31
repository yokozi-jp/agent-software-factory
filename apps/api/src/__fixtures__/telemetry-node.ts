// Detection-power fixture (#43) of `telemetry-node` in lint-restrictions.json (docs/adr/0048): the import below is
// one that no-restricted-imports must report in apps/api/src: the Node-only entry is for the entry files (server.ts,
// telemetry.ts) and the tests. A line below a disable comment is one that the rule must report: if the rule is turned
// off, drops the value, or its `files` stop reaching this file, the comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). A line of the table with no comment above is one that the rule must let through:
// if it stops it, `vp check` fails. repo-policy checks that every line here is a row of the table, and every row a
// line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// oxlint-disable-next-line no-restricted-imports -- fixture: a deep import of a package, from a file that is not an entry file
import "@agent-software-factory/telemetry/node";
