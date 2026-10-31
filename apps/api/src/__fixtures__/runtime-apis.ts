// Detection-power fixture (#43) for the runtime-specific globals in apps/api/src (root vite.config.ts,
// docs/adr/0007). Each line below is one that no-restricted-globals, no-restricted-properties or
// import/no-nodejs-modules must report.
// If a rule is turned off, or its `files` stop reaching apps/api/src/, the disable comment is unused and
// `vp check` fails (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports this file.
// oxlint-disable-next-line no-restricted-globals -- fixture: a bare global
export const bare: unknown = process;
// oxlint-disable-next-line no-restricted-properties -- fixture: a global read from globalThis
export const viaGlobalThis: unknown = globalThis.process;
// oxlint-disable-next-line no-restricted-properties -- fixture: a global read from globalThis by a string
export const viaString: unknown = globalThis["process"];
// oxlint-disable-next-line no-restricted-globals -- fixture: global is the Node.js alias of globalThis
export const viaGlobal: unknown = global;
// oxlint-disable-next-line no-restricted-properties -- fixture: destructuring a global from globalThis
export const { process: destructured }: { process: unknown } = globalThis;
// oxlint-disable-next-line import/no-nodejs-modules -- fixture: a Node.js built-in module
import "node:fs";

// Detection-power fixture (#327) for the ban on `console` (docs/adr/0049, root vite.config.ts). The ban is
// `no-restricted-globals` (a bare name, an alias, a destructuring) and `no-restricted-properties` (`globalThis.console`),
// both from `runtimeGlobals`; `no-console` is not used because it lets an alias and `globalThis.console` through.
// Each line below is one that must be reported.
// oxlint-disable-next-line no-restricted-globals -- fixture: a bare console
export const consoleBare: unknown = console;
// oxlint-disable-next-line no-restricted-globals -- fixture: an alias of console
const alias: unknown = console;
export const consoleAlias = alias;
// oxlint-disable-next-line no-restricted-properties -- fixture: console read from globalThis
export const consoleViaGlobalThis: unknown = globalThis.console;
// oxlint-disable-next-line no-restricted-properties -- fixture: console read from globalThis by a string
export const consoleViaString: unknown = globalThis["console"];
// oxlint-disable-next-line no-restricted-properties -- fixture: destructuring console from globalThis
export const { console: consoleDestructured }: { console: unknown } = globalThis;
