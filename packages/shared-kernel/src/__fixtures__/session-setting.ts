// Detection-power fixture (#43) for SQL that changes the role or the tenant of the connection outside the helper of the
// transaction in packages/shared-kernel/src (root vite.config.ts, tenant-sql/no-session-setting, docs/adr/0029). Each line below is one that
// the rule must report. If the rule is turned off, or its `files` stop reaching packages/shared-kernel/src, the disable comment is
// unused and `vp check` fails (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/, and nothing
// imports this file.
import { sql } from "kysely";

// oxlint-disable-next-line tenant-sql/no-session-setting -- fixture: switches the role of the connection
export const setRole = sql`SET LOCAL ROLE claim_module`;
// oxlint-disable-next-line tenant-sql/no-session-setting -- fixture: sets the tenant without inTenantTransaction
export const setTenant = sql`SELECT set_config('app.current_tenant', ${"x"}, true)`;
