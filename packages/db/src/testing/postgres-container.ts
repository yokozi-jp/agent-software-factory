import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { postgresImage } from "./connection.ts";

/**
 * テストが起動する PostgreSQL の、永続化を切る設定。使い捨ての DB なので、ディスクへの同期書き込みを待たない。
 * PostgreSQL 公式の「Non-Durable Settings」(https://www.postgresql.org/docs/17/non-durability.html) の 3 つで、
 * OS が落ちたときにデータが壊れるだけで、ロックとトランザクションの分離、実行計画は変わらない。
 */
const nonDurableSettings = [
  "-c",
  "fsync=off",
  "-c",
  "synchronous_commit=off",
  "-c",
  "full_page_writes=off",
] as const;

/** テストの globalSetup が使う PostgreSQL を起動する。 */
export function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(postgresImage)
    .withCommand(["postgres", ...nonDurableSettings])
    .start();
}
