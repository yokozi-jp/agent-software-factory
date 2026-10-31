// Detection-power fixture (#43) of `session-setting` in lint-restrictions.json (docs/adr/0029): each line below is
// SQL that changes the role or the tenant of the connection outside the helper of the transaction, which
// tenant-sql/no-session-setting must report in apps/api/src. A line below a disable comment is one that the rule must
// report: if the rule is turned off, drops the value, or its `files` stop reaching this file, the comment is unused
// and `vp check` fails (reportUnusedDisableDirectives). A line of the table with no comment above is one that the
// rule must let through: if it stops it, `vp check` fails. repo-policy checks that every line here is a row of the
// table, and every row a line (docs/tooling/ci.md ("禁止の表")). Knip and jscpd skip __fixtures__/, and nothing imports
// this file.
import { sql } from "kysely";

// oxlint-disable-next-line tenant-sql/no-session-setting -- fixture: switches the role of the connection
export const setRole = sql`SET LOCAL ROLE claim_module`;
// oxlint-disable-next-line tenant-sql/no-session-setting -- fixture: sets the tenant without inTenantTransaction
export const setTenant = sql`SELECT set_config('app.current_tenant', ${"x"}, true)`;
