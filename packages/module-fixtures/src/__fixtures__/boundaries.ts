// Detection-power fixture (#43) for the module boundaries (root vite.config.ts, docs/adr/0026). It is the one for
// every package: the override reaches packages/*/src/**.
// The direction between the modules is not a lint rule: a module resolves only the packages its package.json
// declares. The first import below shows it. module-fixtures declares no package, so the import does not resolve; if
// a setting lets it resolve (tsconfig paths, a hoisted node_modules), the @ts-expect-error is unused and
// `vp check` fails (TS2578). repo-policy checks that the declarations point one way.
// The second import is one that no-restricted-imports must report. If the rule is turned off, or its `files` stop
// reaching packages/*/src/, the disable comment is unused and `vp check` fails (reportUnusedDisableDirectives).
// It shows the lint rule only. That the exports of a package name its src/index.ts alone is checked by repo-policy
// (packageManifests), not here: module-fixtures depends on no package, so no subpath of one could resolve.
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: module-fixtures does not depend on shared, so the import does not resolve
import "@agent-software-factory/shared-kernel";
// @ts-expect-error -- fixture: module-fixtures does not depend on shared; the line is for the lint rule below
// oxlint-disable-next-line no-restricted-imports -- fixture: a deep import
import "@agent-software-factory/shared-kernel/src/index.ts";
