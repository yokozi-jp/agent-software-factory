// Detection-power fixture (#43) for withTables in infrastructure/ (root vite.config.ts, `withTablesEntry`,
// docs/adr/0029). infrastructure is the one layer that may call it, so the call below has no disable comment: if the
// override of the layer stops allowing it, Oxlint reports the call and `vp check` fails. repo-policy checks that this
// file exists, and that the other layers have a call with a disable comment (application/__fixtures__/with-tables.ts).
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
declare const trx: { withTables(): unknown };

export const tables = trx.withTables();
