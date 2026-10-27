// Detection-power fixture (#43) for the override of the tests in packages/shared/src (root vite.config.ts,
// docs/adr/0007). That override turns off the runtime restrictions, and must leave the import restrictions of
// docs/adr/0026. The file is named *.test.ts so that the override reaches it; Knip skips __fixtures__/. If the
// override turns off no-restricted-imports, the disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives).
// oxlint-disable-next-line no-restricted-imports -- fixture: a relative path into a package
import "../../../claim/src/index.ts";
