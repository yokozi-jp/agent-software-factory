/**
 * テストと型の生成 (db/types.ts) が起動する PostgreSQL のイメージ。版を上げるときは、ここ 1 か所を直す。
 * 型を生成する DB とテストの DB の版がずれないようにする。
 */
export const postgresImage = "postgres:17";

/** bootstrap.sql が作るロール。 */
export const roles = ["migrator", "app_user", "auth_service"] as const;

/** migration を流し終えた DB の名前。テストごとの DB は、これを TEMPLATE にして複製する (docs/adr/0025)。 */
export const templateDatabase = "template_factory";

/** base の接続先で、ユーザーとデータベースを替えた URI。ユーザーを渡さなければ base のユーザーのまま。 */
export function connectionUri(
  base: string,
  database: string,
  login?: { user: string; password: string },
): string {
  const url = new URL(base);
  if (login !== undefined) {
    url.username = login.user;
    url.password = login.password;
  }
  url.pathname = `/${database}`;
  return url.toString();
}

/** dbmate に渡す、migrator で接続する URL。testcontainers の PostgreSQL は TLS を使わない。 */
export function migratorUrl(base: string, database: string, password: string): string {
  return `${connectionUri(base, database, { user: "migrator", password })}?sslmode=disable`;
}
