// Detection-power fixture (#43) of `outbox` in lint-restrictions.json (docs/adr/0029): each import below is one that
// no-restricted-imports must report in packages/*/src/application. A line below a disable comment is one that the
// rule must report: if the rule is turned off, drops the value, or its `files` stop reaching this file, the comment
// is unused and `vp check` fails (reportUnusedDisableDirectives). A line of the table with no comment above is one
// that the rule must let through: if it stops it, `vp check` fails. repo-policy checks that every line here is a row
// of the table, and every row a line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing
// imports this file.
// The package declares none of the SDK clients, so each import does not resolve, and the @ts-expect-error says so. If
// one becomes resolvable here (a declared dependency, a hoisted node_modules), the directive is unused (TS2578).
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
