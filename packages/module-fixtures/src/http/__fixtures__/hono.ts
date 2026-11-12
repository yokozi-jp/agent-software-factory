// Detection-power fixture (#43) of `hono` in lint-restrictions.json (docs/adr/0026): each import below is one that
// no-restricted-imports must let through in packages/*/src/http. An http directory is where the routes, the middleware and the hooks are written.
// A line with no disable comment above is one that the rule must let through: if it stops it, `vp check` fails.
// repo-policy checks that every line here is a row of the table, and every row a line (docs/tooling/ci.md ("禁止の表")).
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
// The package declares none of the Hono packages, so each import does not resolve, and the @ts-expect-error says so. If one
// becomes resolvable here (a declared dependency, a hoisted node_modules), the directive is unused (TS2578).
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
import "hono";
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
import "@hono/zod-openapi";
