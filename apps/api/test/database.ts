import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { inject } from "vite-plus/test";

import { rolePassword } from "./credentials.ts";

const authSchemaSql = readFileSync(new URL("../db/auth-schema.sql", import.meta.url), "utf8");

function connectionUri(base: string, user: string, password: string, database: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

export interface TestDatabase {
  /** データベースの所有者。migration と、テストの準備に使う。 */
  readonly owner: Pool;
  /** Better Auth が使うロール。search_path は auth。 */
  readonly authService: Pool;
  /** 業務の処理が使うロール。auth スキーマの権限を持たない。 */
  readonly appUser: Pool;
  close(): Promise<void>;
}

/** テストごとに空のデータベースを作り、auth スキーマと権限を db/auth-schema.sql で用意する。 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const base = inject("postgresUri");
  const name = `t_${randomBytes(6).toString("hex")}`;

  const bootstrap = new Pool({ connectionString: base });
  await bootstrap.query(`CREATE DATABASE ${name}`);
  await bootstrap.end();

  const ownerUser = new URL(base).username;
  const ownerPassword = new URL(base).password;
  const owner = new Pool({ connectionString: connectionUri(base, ownerUser, ownerPassword, name) });
  await owner.query(`GRANT CONNECT ON DATABASE ${name} TO auth_service, app_user`);
  await owner.query(authSchemaSql);

  const authService = new Pool({
    connectionString: connectionUri(base, "auth_service", rolePassword, name),
    options: "-c search_path=auth",
  });
  const appUser = new Pool({
    connectionString: connectionUri(base, "app_user", rolePassword, name),
  });

  return {
    owner,
    authService,
    appUser,
    async close() {
      await Promise.all([owner.end(), authService.end(), appUser.end()]);
    },
  };
}
