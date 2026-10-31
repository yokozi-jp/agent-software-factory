// Detection-power fixture (#43) of `console` in lint-restrictions.json (docs/adr/0049): each line below is a way of
// reaching `console` in packages/*/src that no-restricted-globals (a bare name, an alias) or no-restricted-properties
// (`globalThis.console`, a string key, a destructuring) must report. no-console is not used: it lets an alias and
// `globalThis.console` through. A line below a disable comment is one that the rule must report: if the rule is
// turned off, drops the value, or its `files` stop reaching this file, the comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). A line of the table with no comment above is one that the rule must let through:
// if it stops it, `vp check` fails. repo-policy checks that every line here is a row of the table, and every row a
// line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// The package has no Node.js types, so each line is also a type error, and the @ts-expect-error says so.
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-globals -- fixture: a bare console
export const consoleBare: unknown = console;
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-globals -- fixture: an alias of console
const alias: unknown = console;
export const consoleAlias = alias;
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-properties -- fixture: console read from globalThis
export const consoleViaGlobalThis: unknown = globalThis.console;
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-properties -- fixture: console read from globalThis by a string
export const consoleViaString: unknown = globalThis["console"];
// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line no-restricted-properties -- fixture: destructuring console from globalThis
export const { console: consoleDestructured }: { console: unknown } = globalThis;
