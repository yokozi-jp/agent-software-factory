// Detection-power fixture (#43) for the module boundaries of claim (root vite.config.ts, docs/adr/0026). Each
// import below is one that no-restricted-imports must report. If the rule is turned off, or its `files` stop
// reaching packages/claim/src/, the disable comments are unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: claim does not depend on approval, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: the reverse of closing → approval → claim
import "@agent-software-factory/approval";
// @ts-expect-error -- fixture: the package.json of shared exports only its index.ts
// oxlint-disable-next-line no-restricted-imports -- fixture: a deep import
import "@agent-software-factory/shared/src/index.ts";
