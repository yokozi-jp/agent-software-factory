// Detection-power fixture (#43) for the module boundaries in the entry files and tests of apps/api (root
// vite.config.ts, docs/adr/0026). The file is named *.test.ts so that the override of the tests reaches it;
// Vitest (apps/api/vite.config.ts) and Knip skip __fixtures__/. If the rule is turned off there, the disable
// comment is unused and `vp check` fails (reportUnusedDisableDirectives).
// oxlint-disable-next-line no-restricted-imports -- fixture: a relative path into a package
import "../../../../packages/claim/src/index.ts";
