// Detection-power fixture (#43) for withTables outside infrastructure/ (root vite.config.ts, `withTablesEntry`,
// docs/adr/0029). The call below is one that no-restricted-properties must report. If the rule is turned off, or
// the override stops reaching packages/*/src/domain, the disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). repo-policy checks that src, domain, application and http each have one, and that
// infrastructure has a call with no disable comment, so that the rule does not reach it.
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
declare const trx: { withTables(): unknown };

// oxlint-disable-next-line no-restricted-properties -- fixture: another module's types from here
export const tables = trx.withTables();
