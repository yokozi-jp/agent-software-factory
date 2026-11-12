// Detection-power fixture (#43) of `hono` in lint-restrictions.json (docs/adr/0026): each import below is one that
// no-restricted-imports must report in packages/logging/src/infrastructure (a driver is not an HTTP part). Hono is imported in an HTTP part only.
// A line below a disable comment is one that the rule must report: if the rule is turned off, drops the value, or its
// `files` stop reaching this file, the comment is unused and `vp check` fails (reportUnusedDisableDirectives).
// repo-policy checks that every line here is a row of the table, and every row a line (docs/tooling/ci.md ("禁止の表")).
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
// The package declares none of the Hono packages, so each import does not resolve, and the @ts-expect-error says so. If one
// becomes resolvable here (a declared dependency, a hoisted node_modules), the directive is unused (TS2578).
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: Hono is imported in an HTTP part only (src/http/, app.ts, server.ts)
import "hono";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: Hono is imported in an HTTP part only (src/http/, app.ts, server.ts)
import "@hono/zod-openapi";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: Hono is imported in an HTTP part only (src/http/, app.ts, server.ts)
import "@hono/otel";
