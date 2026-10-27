import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { inject } from "vite-plus/test";

import { rolePassword } from "./credentials.ts";
import { connectionUri } from "./connection.ts";

export interface TestDatabase {
  /** superuser (testcontainers の master user)。中身の確認に使う。表の所有者は migrator。 */
  readonly superuser: Pool;
  /** 表とスキーマの所有者。migration を流すロール。 */
  readonly migrator: Pool;
  /** Better Auth が使うロール。search_path は auth。 */
  readonly authService: Pool;
  /** authService と同じロールで接続する URL。別のプロセスで動かす API に渡す。 */
  readonly authServiceUrl: string;
  /** 業務の処理が使うロール。auth スキーマの権限を持たない。 */
  readonly appUser: Pool;
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
  const authServiceUrl = loginAs("auth_service");
  const authService = new Pool({
    connectionString: authServiceUrl,
    options: "-c search_path=auth",
  });
  const appUser = new Pool({ connectionString: loginAs("app_user") });

  return {
    superuser,
    migrator,
    authService,
    authServiceUrl,
    appUser,
    async close() {
      await Promise.all([superuser.end(), migrator.end(), authService.end(), appUser.end()]);
    },
  };
}
