// Detection-power fixture (#43) for the override of packages/telemetry/src (root vite.config.ts, docs/adr/0048).
// This package is the one that starts the SDK, so the SDK import below carries no disable comment: if the override
// stops letting it through, Oxlint reports it and `vp check` fails. The override keeps the other restrictions of the
// packages, which the SQS import below shows (a send skips the Outbox, docs/adr/0029). repo-policy checks both.
// Knip skips __fixtures__/, and nothing imports this file.
import "@opentelemetry/sdk-node";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: an SDK client that sends without the Outbox
import "@aws-sdk/client-sqs";
