// Detection-power fixture (#43) of `telemetry-node` in lint-restrictions.json (docs/adr/0048): the import below is
// one that no-restricted-imports must report in apps/web/src, which does not start OpenTelemetry. A line below a
// disable comment is one that the rule must report: if the rule is turned off, drops the value, or its `files` stop
// reaching this file, the comment is unused and `vp check` fails (reportUnusedDisableDirectives). A line of the table
// with no comment above is one that the rule must let through: if it stops it, `vp check` fails. repo-policy checks
// that every line here is a row of the table, and every row a line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip
// __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: apps/web does not depend on packages/telemetry, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: the Node-only entry that starts the SDK
import "@agent-software-factory/telemetry/node";
