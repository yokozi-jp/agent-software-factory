import { sql, type QueryExecutorProvider, type RawBuilder } from "kysely";

/**
 * Inserts one row into `table` in the open transaction `trx`. The columns are the keys of `row`, which the caller types
 * from the table (`Insertable<…>`); the names are quoted as identifiers and the values are bind parameters.
 *
 * The transaction of a module has the types of its own tables only, and shared-kernel does not import the generated types of
 * a module, so a table of another schema (`messaging.outbox`) and the table `processed_message` of any module are
 * written with `sql`, which shared-kernel may import (docs/adr/0029). Add `suffix` for what follows `VALUES`, such as
 * `ON CONFLICT … RETURNING …`.
 */
export const insertRow = <Row extends Readonly<Record<string, unknown>>>(
  trx: QueryExecutorProvider,
  table: RawBuilder<unknown>,
  row: Row,
  suffix: RawBuilder<unknown> = sql``,
) => {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  return sql<Record<string, unknown>>`INSERT INTO ${table} (${sql.join(
    entries.map(([column]) => sql.id(column)),
  )}) VALUES (${sql.join(entries.map(([, value]) => sql.val(value)))}) ${suffix}`.execute(trx);
};
