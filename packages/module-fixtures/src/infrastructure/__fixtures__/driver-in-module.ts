// Detection-power fixture (#43) of `driver-in-module` in lint-restrictions.json (docs/adr/0054): each import below is one that
// no-restricted-imports must let through in packages/*/src/infrastructure: the infrastructure of a module wraps a driver and
// implements a Port with it.
// A line below a disable comment is one that the rule must report: if the rule is turned off, drops the value, or its
// `files` stop reaching this file, the comment is unused and `vp check` fails (reportUnusedDisableDirectives). A line
// of the table with no comment above is one that the rule must let through: if it stops it, `vp check` fails. repo-policy
// checks that every line here is a row of the table, and every row a line (docs/tooling/ci.md ("禁止の表")). Knip and
// jscpd skip __fixtures__/, and nothing imports this file.
// The package declares none of the drivers, so each import does not resolve, and the @ts-expect-error says so. If one
// becomes resolvable here (a declared dependency, a hoisted node_modules), the directive is unused (TS2578).
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
import "@agent-software-factory/hr-system/client";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
import "@agent-software-factory/i18n";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
import "@agent-software-factory/logging";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
import "@agent-software-factory/telemetry";
