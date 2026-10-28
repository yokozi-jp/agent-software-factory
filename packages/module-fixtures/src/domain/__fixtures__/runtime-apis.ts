// Detection-power fixture (#43) for the runtime-specific globals in packages/*/src/domain (root vite.config.ts,
// docs/adr/0007). The domain override sets no-restricted-globals and no-restricted-properties for its own rules
// (docs/adr/0027), and must keep the runtime restrictions as well. If it drops them, the disable comments are unused
// and `vp check` fails (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-globals -- fixture: a bare global
export const bare: unknown = process;
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-properties -- fixture: a global read from globalThis
export const viaGlobalThis: unknown = globalThis.process;
