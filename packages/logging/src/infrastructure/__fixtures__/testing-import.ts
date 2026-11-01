// Detection-power fixture (#43) of `testing-import` in lint-restrictions.json (docs/adr/0054): each import below is one that
// no-restricted-imports must report in packages/logging/src/infrastructure. The code of a layer does not import testing/, which
// holds the tools of the tests. A line below a disable comment is one that the rule must report: if the rule is turned
// off, drops the value, or its `files` stop reaching this file, the comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). repo-policy checks that every line here is a row of the table, and every row a line
// (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// oxlint-disable-next-line no-restricted-imports -- fixture: production code does not import the entry of the tools of the tests
import "../../testing.ts";
// oxlint-disable-next-line no-restricted-imports -- fixture: production code does not import a file of testing/
import "../../testing/memory-destination.ts";
