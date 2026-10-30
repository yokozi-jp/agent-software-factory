// Detection-power fixture (#43) for the ban on the OpenTelemetry SDK (apps/api/src, root vite.config.ts,
// docs/adr/0047). Outside packages/telemetry and the entry files of the apps, only @opentelemetry/api may be
// imported: the SDK, the exporters and the instrumentations are started in one place. Each line below is one that
// no-restricted-imports must report. If the rule is turned off, or its `files` stop reaching this directory, the disable
// comment is unused and `vp check` fails (reportUnusedDisableDirectives). repo-policy checks that every pattern of
// the rule has a line. Knip skips __fixtures__/, and nothing imports this file.
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
// The Node-only entry of packages/telemetry is for the entry files (server.ts, telemetry.ts) and the tests.
// oxlint-disable-next-line no-restricted-imports -- fixture: a deep import of a package, from a file that is not an entry file
import "@agent-software-factory/telemetry/node";
