// Detection-power fixture (#43) for the layers of closing (root vite.config.ts, docs/adr/0026).
// Each import below is one that no-restricted-imports must report in domain/. If the rule is turned off,
// or its `files` stop reaching packages/closing/src/domain/, the disable comments are unused and
// `vp check` fails (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/. Only the
// fixtures of the other layers import this file, to break the rule.
// @ts-expect-error -- fixture: the module does not depend on shared, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: domain imports only the types of shared
import "@agent-software-factory/shared";
// @ts-expect-error -- fixture: the module does not depend on hono, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: domain imports no library
import "hono";
// oxlint-disable-next-line no-restricted-imports -- fixture: domain imports no other layer
import "../../application/__fixtures__/boundaries.ts";
// The one import that domain may have: a type of shared. It carries no disable comment, so `vp check`
// fails if the rule stops it.
// @ts-expect-error -- fixture: the module does not depend on shared, so the import does not resolve
export type { Shared } from "@agent-software-factory/shared";
