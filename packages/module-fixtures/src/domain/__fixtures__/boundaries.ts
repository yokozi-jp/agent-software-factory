// Detection-power fixture (#43) for the layers of the modules (root vite.config.ts, docs/adr/0026).
// Each import below is one that no-restricted-imports must report in domain/. If the rule is turned off,
// or its `files` stop reaching packages/*/src/domain/, the disable comments are unused and
// `vp check` fails (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/. Only the
// fixtures of the other layers import this file, to break the rule.
// @ts-expect-error -- fixture: the module does not depend on shared-kernel, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: domain imports only the types of shared-kernel
import "@agent-software-factory/shared-kernel";
// @ts-expect-error -- fixture: the module does not depend on shared-kernel, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: domain imports no value of the entry result either
import "@agent-software-factory/shared-kernel/result";
// @ts-expect-error -- fixture: the module does not depend on shared-kernel, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: domain imports no other entry of shared-kernel, not even its types
import type {} from "@agent-software-factory/shared-kernel/time";
// @ts-expect-error -- fixture: the module does not depend on hono, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: domain imports no library
import "hono";
// oxlint-disable-next-line no-restricted-imports -- fixture: domain imports no other layer
import "../../application/__fixtures__/boundaries.ts";
// The imports that domain may have: a type of shared-kernel and of its entry result (docs/adr/0051). They carry no
// disable comment, so `vp check` fails if the rule stops them.
// @ts-expect-error -- fixture: the module does not depend on shared-kernel, so the import does not resolve
export type { SharedKernel } from "@agent-software-factory/shared-kernel";
// @ts-expect-error -- fixture: the module does not depend on shared-kernel, so the import does not resolve
export type { Result } from "@agent-software-factory/shared-kernel/result";
