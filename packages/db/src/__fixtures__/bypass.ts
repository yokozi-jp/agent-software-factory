// Detection-power fixture (#43) for the override of packages/db/src in the root vite.config.ts (docs/adr/0029,
// docs/adr/0038). db opens the connections, so the pg import below carries no disable comment: if the override stops
// allowing it, Oxlint reports it and `vp check` fails. db does not send, so each SDK import must be reported.
// repo-policy checks that every package of `outboxPackages` has a line here.
import "pg";
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
