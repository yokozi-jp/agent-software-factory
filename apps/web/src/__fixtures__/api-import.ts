// Detection-power fixture for the no-restricted-imports of apps/web/src that stops `@agent-software-factory/api`
// outside apps/web/src/lib/api-client.ts (root vite.config.ts, docs/adr/0047). If the rule stops reaching this directory,
// the disable comment is unused and `vp check` fails (reportUnusedDisableDirectives). Nothing imports this file.

// oxlint-disable-next-line no-restricted-imports -- fixture: the API's types are imported only in lib/api-client.ts
import type { AppType } from "@agent-software-factory/api";

export type Contract = AppType;
