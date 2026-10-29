// Detection-power fixture (#43) for the override of the entry files and the tests in apps/api/src (root
// vite.config.ts, docs/adr/0029). That override leaves `connectionPackages` out, because the entry file makes the pool
// and a test reads the database. The file is named *.test.ts so that the override reaches it. The pg import below
// carries no disable comment: if the override stops allowing it, Oxlint reports it and `vp check` fails.
// The override keeps `outboxPackages`: a send from an entry file or a test skips the Outbox too, so each SDK import
// below must be reported. repo-policy checks that every package of `outboxPackages` has a line here.
// Knip reads a *.test.ts file even in __fixtures__/, so the SDK clients are in `ignoreDependencies` of apps/api in
// knip.jsonc; jscpd and coverage skip __fixtures__/.
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
