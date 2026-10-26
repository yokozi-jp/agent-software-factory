// Detection-power fixture (#43) for the module boundaries of approval (root vite.config.ts, docs/adr/0026).
// Each import below is one that no-restricted-imports must report. If the rule is turned off, or its `files`
// stop reaching packages/approval/src/, the disable comments are unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: approval does not depend on closing, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: the reverse of closing → approval → claim
import "@agent-software-factory/closing";
// @ts-expect-error -- fixture: the package.json of claim exports only its index.ts
// oxlint-disable-next-line no-restricted-imports -- fixture: a deep import
import "@agent-software-factory/claim/src/index.ts";
