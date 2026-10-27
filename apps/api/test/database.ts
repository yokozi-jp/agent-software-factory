import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { inject } from "vite-plus/test";

import { rolePassword } from "./credentials.ts";
import { connectionUri } from "./connection.ts";

export interface TestDatabase {
  /** superuser。テストの準備と、中身の確認に使う。 */
  readonly owner: Pool;
  /** 表とスキーマの所有者。migration を流すロール。 */
  readonly migrator: Pool;
  /** Better Auth が使うロール。search_path は auth。 */
  readonly authService: Pool;
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

  const bootstrap = new Pool({ connectionString: base });
  await bootstrap.query(`CREATE DATABASE ${name} TEMPLATE ${inject("templateDatabase")}`);
  await bootstrap.end();

  const as = (user: string) => connectionUri(base, name, { user, password: rolePassword });
  const owner = new Pool({ connectionString: connectionUri(base, name) });
  const migrator = new Pool({ connectionString: as("migrator") });
  const authService = new Pool({
    connectionString: as("auth_service"),
    options: "-c search_path=auth",
  });
  const appUser = new Pool({ connectionString: as("app_user") });

  return {
    owner,
    migrator,
    authService,
    appUser,
    async close() {
      await Promise.all([owner.end(), migrator.end(), authService.end(), appUser.end()]);
    },
  };
}
