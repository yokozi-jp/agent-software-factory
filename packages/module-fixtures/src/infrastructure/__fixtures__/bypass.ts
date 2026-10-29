// Detection-power fixture (#43) for the imports that bypass the Outbox and the transaction in
// packages/*/src/infrastructure
// (root vite.config.ts, `outboxPackages` and `connectionPackages`, docs/adr/0029). Each import below is one that
// no-restricted-imports must report. If the rule is turned off, drops a package, or its `files` stop reaching
// packages/*/src/infrastructure, the disable comment is unused and `vp check` fails (reportUnusedDisableDirectives).
// repo-policy checks that every package of the two lists has a line here.
// module-fixtures declares none of these packages, so each import does not resolve; the @ts-expect-error says so.
// If a package becomes resolvable here (a declared dependency, a hoisted node_modules), the directive is unused
// and `vp check` fails (TS2578). Knip and jscpd skip __fixtures__/, and nothing imports this file.
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
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: a connection that skips inTenantTransaction
import "pg";
// The raw SQL of Kysely (root vite.config.ts, `sqlImportNames`, docs/adr/0029). kysely is not a dependency of this package
// either, so the directive says the same.
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: raw SQL that skips the types of the builder
export { sql } from "kysely";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: a compiled query that skips the types of the builder
export { CompiledQuery } from "kysely";
