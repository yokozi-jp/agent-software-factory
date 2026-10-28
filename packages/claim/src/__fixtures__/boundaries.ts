// Detection-power fixture (#43) for the module boundaries (root vite.config.ts, docs/adr/0026). It is the one for
// every package: the override reaches packages/*/src/**.
// The direction between the modules is not a lint rule: a module resolves only the packages its package.json
// declares. The first import below shows it. claim does not declare approval, so the import does not resolve; if
// a setting lets it resolve (tsconfig paths, a hoisted node_modules), the @ts-expect-error is unused and
// `vp check` fails (TS2578). repo-policy checks that the declarations point one way.
// The second import is one that no-restricted-imports must report. If the rule is turned off, or its `files` stop
// reaching packages/*/src/, the disable comment is unused and `vp check` fails (reportUnusedDisableDirectives).
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: claim does not depend on approval, so the import does not resolve
import "@agent-software-factory/approval";
// @ts-expect-error -- fixture: the package.json of shared exports only its index.ts
// oxlint-disable-next-line no-restricted-imports -- fixture: a deep import
import "@agent-software-factory/shared/src/index.ts";
