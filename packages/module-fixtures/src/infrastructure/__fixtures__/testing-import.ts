// Detection-power fixture (#43) of `testing-import` in lint-restrictions.json (docs/adr/0054) for packages/*/src/infrastructure:
// the same import as ../../application/__fixtures__/testing-import.ts, which says what it shows. The module has no testing/,
// so the import does not resolve.
// @ts-expect-error -- fixture: this package has no testing/, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: production code does not import the entry of the tools of the tests
import "../../testing.ts";
