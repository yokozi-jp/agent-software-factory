import type { QueryResult, QueryResultRow } from "pg";

/**
 * 問い合わせを流せる口。カタログの検査 (module-roles-catalog.ts、convention-catalog.ts) が受け取る。
 * `Pool` も、1 つのトランザクションの接続 (testing/rolled-back.ts) も、この形で渡せる。
 */
export interface Queryable {
  query<Row extends QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
}
