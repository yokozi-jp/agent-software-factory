// Detection-power fixture (#43) for the module boundaries of shared (root vite.config.ts, docs/adr/0026). Each
// import below is one that no-restricted-imports must report. If the rule is turned off, or its `files` stop
// reaching packages/shared/src/, the disable comments are unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: shared does not depend on claim, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: shared must not import a module
import "@agent-software-factory/claim";
