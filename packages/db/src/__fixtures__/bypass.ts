// Detection-power fixture (#43) for the override of packages/db/src in the root vite.config.ts (docs/adr/0029,
// docs/adr/0038). db opens the connections, so the pg import below carries no disable comment: if the override stops
// allowing it, Oxlint reports it and `vp check` fails. db does not send, so each SDK import must be reported.
// repo-policy checks that every package of `outboxPackages` has a line here.
import "pg";
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
