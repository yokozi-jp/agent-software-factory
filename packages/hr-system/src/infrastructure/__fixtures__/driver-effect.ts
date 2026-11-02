// Detection-power fixture (#43) of `driver-effect` in lint-restrictions.json (docs/adr/0054): each import below is one that
// no-restricted-imports must report in packages/hr-system/src/infrastructure. A driver returns a Promise and does not import
// Effect.
// A line below a disable comment is one that the rule must report: if the rule is turned off, drops the value, or its
// `files` stop reaching this file, the comment is unused and `vp check` fails (reportUnusedDisableDirectives).
// repo-policy checks that every line here is a row of the table, and every row a line (docs/tooling/ci.md ("禁止の表")).
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: a driver does not import Effect
import "effect";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: a driver does not import Effect
import "effect/Effect";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: a driver does not import Effect
import "@effect/platform-node";
