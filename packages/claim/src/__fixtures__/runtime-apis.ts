// Detection-power fixture (#43) for the runtime-specific globals in packages/*/src (root vite.config.ts,
// docs/adr/0007). Each line below is one that no-restricted-globals or no-restricted-properties must report.
// If a rule is turned off, or its `files` stop reaching packages/claim/src/, the disable comment is unused and
// `vp check` fails (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-globals -- fixture: a bare global
export const bare: unknown = process;
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-properties -- fixture: a global read from globalThis
export const viaGlobalThis: unknown = globalThis.process;
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-properties -- fixture: a global read from globalThis by a string
export const viaString: unknown = globalThis["process"];
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-globals -- fixture: global is the Node.js alias of globalThis
export const viaGlobal: unknown = global;
