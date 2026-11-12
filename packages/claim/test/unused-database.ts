import { Database } from "@agent-software-factory/shared-kernel/tenant-db";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";

/**
 * `Database` の値で、接続しない Kysely を持つもの。`ClaimStore` を差し替えるテストが、`Database` を求める型を満たすために使う。
 * 本物の DB を使うテストは apps/api の claims.test.ts。
 */
export const unusedDatabase = Database.of({
  db: new Kysely<never>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  }),
});
