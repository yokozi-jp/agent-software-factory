// Detection-power fixture (#43) for the runtime-specific globals read from globalThis in the application layer
// (root vite.config.ts, docs/adr/0007). The override that stops running an Effect in this layer sets
// no-restricted-properties for its own rules, and Oxlint keeps only the last override that sets a rule, so it must
// carry the runtime restrictions too. If it does not, the disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-properties -- fixture: a global read from globalThis
export const viaGlobalThis: unknown = globalThis.process;
