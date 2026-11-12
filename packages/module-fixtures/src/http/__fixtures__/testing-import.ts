// Detection-power fixture (#43) of `testing-import` in lint-restrictions.json (docs/adr/0054): the import below is one that
// no-restricted-imports must report in packages/*/src/http, as in every other layer: the code of a layer does not
// import testing/, which holds the tools of the tests of a driver. The module has no testing/, so the import does not
// resolve, and the @ts-expect-error says so. repo-policy checks that every line here is a row of the table, and every
// row a line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: this package has no testing/, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: production code does not import the entry of the tools of the tests
import "../../testing.ts";
