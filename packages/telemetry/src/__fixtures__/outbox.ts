// Detection-power fixture (#43) of `outbox` in lint-restrictions.json (docs/adr/0029, docs/adr/0048): each import
// below is one that the override of packages/telemetry/src must still report. That override lets the SDK through
// (otel-sdk.ts) and keeps the other restrictions of the packages. A line below a disable comment is one that the rule
// must report: if the rule is turned off, drops the value, or its `files` stop reaching this file, the comment is
// unused and `vp check` fails (reportUnusedDisableDirectives). A line of the table with no comment above is one that
// the rule must let through: if it stops it, `vp check` fails. repo-policy checks that every line here is a row of
// the table, and every row a line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing
// imports this file.
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-sqs";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-ses";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-sesv2";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-sns";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-eventbridge";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-lambda";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-sfn";
