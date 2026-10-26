// Detection-power fixture (#43) for the module boundaries in apps/api/src (root vite.config.ts,
// docs/adr/0026). apps/api may import every module, by its package name only. If the rule is turned off,
// or its `files` stop reaching apps/api/src/, the disable comments are unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: the package.json of claim exports only its index.ts
// oxlint-disable-next-line no-restricted-imports -- fixture: a deep import
import "@agent-software-factory/claim/src/index.ts";
// oxlint-disable-next-line no-restricted-imports -- fixture: a relative path into a package
import "../../../../packages/claim/src/index.ts";
