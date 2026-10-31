import type { QueryResult, QueryResultRow } from "pg";
import { afterAll, afterEach, beforeEach } from "vite-plus/test";

import type { Queryable } from "../queryable.ts";
import { createTestDatabase, type TestDatabase } from "./database.ts";

/** migrator として DDL を流す口。表の所有者が migrator になる。パラメータは取らない。 */
export interface MigratorQuery {
  query(sql: string): Promise<QueryResult>;
}

/** 1 つのトランザクションの中で流す口。 */
export interface RolledBackQueries {
  /** superuser。ロールの変更や GRANT、検査の実行に使う。 */
  readonly superuser: Queryable;
  /** superuser の接続のまま `SET LOCAL ROLE migrator` で流す。DDL の所有者が migrator になる。 */
  readonly migrator: MigratorQuery;
}

/** `openRolledBack` が返す口。`rollback` で変更をすべて捨てる。 */
export interface RolledBackSession extends RolledBackQueries {
  /** ROLLBACK して接続を返す。テストの後に必ず呼ぶ。 */
  rollback(): Promise<void>;
}

/**
 * トランザクションを開き、その中で流す口を返す。テストの後に `rollback` で変更をすべて捨てる。
 *
 * ロールの属性とメンバーシップ (ALTER ROLE、GRANT ロール、RENAME) はクラスタ全体のもので、複製した DB に閉じない
 * (Issue #448)。コミットしない変更は、ほかの接続 (並行して流れる別のテストファイル) から見えない。そのため、
 * 規則を壊す検出力のテストは、ここで壊して検査を呼ぶ。壊した状態を戻す後始末を、テストごとに書かなくてよい。
 *
 * 注意: 失敗した文があるとトランザクションは中止され、その後の文は流れない。壊し方の文が失敗すれば、テストが落ちる。
 */
export async function openRolledBack(db: TestDatabase): Promise<RolledBackSession> {
  const client = await db.superuser.connect();
  // pg の接続は、実行中に次の問い合わせを受けると内部で順番待ちにする。その挙動は pg 9 で廃止されるので、
  // 検査が Promise.all で並べて呼んでも 1 つずつ流れるように、ここで順に並べる。
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  };
  try {
    await client.query("BEGIN");
  } catch (error) {
    client.release();
    throw error;
  }
  return {
    superuser: {
      query: <Row extends QueryResultRow>(sql: string, values?: unknown[]) =>
        serial(() => client.query<Row>(sql, values)),
    },
    migrator: {
      query: (sql) =>
        serial(async () => {
          await client.query("SET LOCAL ROLE migrator");
          try {
            return await client.query(sql);
          } finally {
            await client.query("RESET ROLE");
          }
        }),
    },
    async rollback() {
      try {
        await serial(() => client.query("ROLLBACK"));
      } finally {
        client.release();
      }
    },
  };
}

/**
 * `describe` の中で呼ぶ。ファイルごとに DB を 1 つ作り、テストごとに `openRolledBack` で開いたトランザクションを
 * 後で ROLLBACK する。返す口は、そのときのテストのトランザクションに流す。規則を壊すテストは、この口で壊す (Issue #448)。
 */
export function rolledBackPerTest(): RolledBackQueries {
  let database: TestDatabase | undefined;
  let session: RolledBackSession | undefined;
  const current = (): RolledBackSession => {
    if (session === undefined) throw new Error("テストの中で使う (beforeEach の前後では使えない)");
    return session;
  };

  // DB は最初のテストの前に作り、ファイルの最後に閉じる。
  beforeEach(async () => {
    database ??= await createTestDatabase();
    session = await openRolledBack(database);
  });
  afterEach(async () => {
    await current().rollback();
    session = undefined;
  });
  afterAll(async () => {
    await database?.close();
  });

  return {
    superuser: { query: (sql, values) => current().superuser.query(sql, values) },
    migrator: { query: (sql) => current().migrator.query(sql) },
  };
}
