// Detection-power fixture (#43) for the imports that bypass the Outbox and the transaction in apps/api/src (root
// vite.config.ts, `outboxPackages` and `connectionPackages`, docs/adr/0029). Each import below is one that
// no-restricted-imports must report. If the rule is turned off, drops a package, or the override stops reaching
// apps/api/src/, the disable comment is unused and `vp check` fails (reportUnusedDisableDirectives). repo-policy
// checks that every package of the two lists has a line here.
// apps/api declares pg, so that import resolves; the SDK clients are not dependencies of the app yet, so each one
// does not resolve, and the @ts-expect-error says so. When the app depends on one, remove the directive of that line.
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: @aws-sdk/client-sqs is not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-sqs";
// @ts-expect-error -- fixture: @aws-sdk/client-ses is not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-ses";
// @ts-expect-error -- fixture: @aws-sdk/client-sesv2 is not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-sesv2";
// @ts-expect-error -- fixture: @aws-sdk/client-sns is not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-sns";
// @ts-expect-error -- fixture: @aws-sdk/client-eventbridge is not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-eventbridge";
// @ts-expect-error -- fixture: @aws-sdk/client-lambda is not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-lambda";
// @ts-expect-error -- fixture: @aws-sdk/client-sfn is not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-sfn";
// oxlint-disable-next-line no-restricted-imports -- fixture: a connection that skips inTenantTransaction
import "pg";
