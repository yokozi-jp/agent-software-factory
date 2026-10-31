// Detection-power fixture (#43) of `otel-sdk` in lint-restrictions.json (docs/adr/0048): each import below, one of
// each start of a package name of the table, is one that no-restricted-imports must report in apps/api/src. Only
// @opentelemetry/api may be imported there. A line below a disable comment is one that the rule must report: if the
// rule is turned off, drops the value, or its `files` stop reaching this file, the comment is unused and `vp check`
// fails (reportUnusedDisableDirectives). A line of the table with no comment above is one that the rule must let
// through: if it stops it, `vp check` fails. repo-policy checks that every line here is a row of the table, and every
// row a line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: the SDK
import "@opentelemetry/sdk-node";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an exporter
import "@opentelemetry/exporter-trace-otlp-http";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an instrumentation
import "@opentelemetry/instrumentation-pg";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: the resource of the SDK
import "@opentelemetry/resources";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: the bundle of instrumentations
import "@opentelemetry/auto-instrumentations-node";
