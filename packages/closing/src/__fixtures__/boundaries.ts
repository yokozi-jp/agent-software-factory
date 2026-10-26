// Detection-power fixture (#43) for the module boundaries of closing (root vite.config.ts, docs/adr/0026).
// closing may import both other modules, so the imports below reach past their index.ts. If the rule is turned
// off, or its `files` stop reaching packages/closing/src/, the disable comments are unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: the package.json of approval exports only its index.ts
// oxlint-disable-next-line no-restricted-imports -- fixture: a deep import
import "@agent-software-factory/approval/src/http/index.ts";
// oxlint-disable-next-line no-restricted-imports -- fixture: a relative path into another package
import "../../../claim/src/index.ts";
