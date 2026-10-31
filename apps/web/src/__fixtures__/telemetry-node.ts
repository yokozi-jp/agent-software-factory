// Detection-power fixture (#43) for the ban on the Node-only entry of packages/telemetry in apps/web/src (root
// vite.config.ts, docs/adr/0048). If the pattern is removed, or its `files` stop reaching apps/web/src/, the disable
// comment is unused and `vp check` fails (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports
// this file.

// @ts-expect-error -- fixture: apps/web does not depend on packages/telemetry, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: the Node-only entry that starts the SDK
import "@agent-software-factory/telemetry/node";
