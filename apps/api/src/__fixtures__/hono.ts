// Detection-power fixture (#43) of `hono` in lint-restrictions.json (docs/adr/0026): each import below is one that
// no-restricted-imports must report in apps/api/src outside http/, app.ts and the entry files. Hono is imported in an HTTP part only.
// A line below a disable comment is one that the rule must report: if the rule is turned off, drops the value, or its
// `files` stop reaching this file, the comment is unused and `vp check` fails (reportUnusedDisableDirectives).
// repo-policy checks that every line here is a row of the table, and every row a line (docs/tooling/ci.md ("禁止の表")).
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
// oxlint-disable-next-line no-restricted-imports -- fixture: Hono is imported in an HTTP part only (src/http/, app.ts, server.ts)
import "hono";
// oxlint-disable-next-line no-restricted-imports -- fixture: Hono is imported in an HTTP part only (src/http/, app.ts, server.ts)
import "@hono/zod-openapi";
// oxlint-disable-next-line no-restricted-imports -- fixture: Hono is imported in an HTTP part only (src/http/, app.ts, server.ts)
import "@hono/otel";
