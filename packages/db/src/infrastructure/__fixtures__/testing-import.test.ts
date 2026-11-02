// Detection-power fixture (#43) of `testing-import` in lint-restrictions.json (docs/adr/0054): the import below is one that
// no-restricted-imports must let through in a test of packages/db/src/infrastructure. If the rule stops it, `vp check`
// fails. repo-policy checks that every line here is a row of the table, and every row a line (docs/tooling/ci.md
// ("禁止の表")). Knip and jscpd skip __fixtures__/.
import "../../testing.ts";
