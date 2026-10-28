import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { inject } from "vite-plus/test";

import { rolePassword } from "./credentials.ts";
import { connectionUri, roles } from "./connection.ts";

// The values that globalSetup provides: apps/api and the db package each start the PostgreSQL and provide these two.
declare module "vite-plus/test" {
  export interface ProvidedContext {
    postgresUri: string;
    /** migration を流し終えた DB。テストごとの DB は、これを TEMPLATE にして複製する。 */
    templateDatabase: string;
  }
}

export interface TestDatabase {
  /** superuser (testcontainers の master user)。中身の確認に使う。表の所有者は migrator。 */
  readonly superuser: Pool;
  /** 表とスキーマの所有者。migration を流すロール。 */
  readonly migrator: Pool;
  /** Better Auth が使うロール。search_path は auth。 */
  readonly authService: Pool;
  /** 業務の処理が使うロール。auth スキーマの権限を持たない。 */
  readonly appUser: Pool;
  /** このデータベースの接続 URI。ロールを渡さなければ superuser。別のプロセスで動かす API にも渡す。 */
  url(role?: (typeof roles)[number]): string;
  close(): Promise<void>;
}

/**
 * テストごとにデータベースを作る。globalSetup が本番と同じ経路 (bootstrap.sql と dbmate) で
 * migration を流したテンプレートの DB を複製するので、auth スキーマと権限はそろっている (docs/adr/0025)。
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const base = inject("postgresUri");
  const name = `t_${randomBytes(6).toString("hex")}`;

  const maintenance = new Pool({ connectionString: base });
  await maintenance.query(`CREATE DATABASE ${name} TEMPLATE ${inject("templateDatabase")}`);
  await maintenance.end();

  const loginAs = (user: string) => connectionUri(base, name, { user, password: rolePassword });
  const superuser = new Pool({ connectionString: connectionUri(base, name) });
  const migrator = new Pool({ connectionString: loginAs("migrator") });
  const authService = new Pool({
    connectionString: loginAs("auth_service"),
    options: "-c search_path=auth",
  });
  const appUser = new Pool({ connectionString: loginAs("app_user") });

  return {
    superuser,
    migrator,
    authService,
    appUser,
    url: (role) => (role === undefined ? connectionUri(base, name) : loginAs(role)),
    async close() {
      await Promise.all([superuser.end(), migrator.end(), authService.end(), appUser.end()]);
    },
  };
}
