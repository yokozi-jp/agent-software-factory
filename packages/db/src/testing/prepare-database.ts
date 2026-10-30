import { Client } from "pg";

import { migrate } from "../migrate.ts";
import { bootstrapSql } from "../bootstrap.ts";
import { connectionUri, migratorUrl, roles } from "./connection.ts";
import { rolePassword } from "./credentials.ts";
import { seed } from "../seed/index.ts";

/**
 * 本番と同じ経路で、`base` の PostgreSQL に `database` を作り、migration を流す (docs/adr/0025)。
 * 1. master user (testcontainers の superuser) が bootstrap.sql でロールを作る。ロールはクラスタ全体で共有する。
 * 2. migrator が dbmate で migration を流す。ローカルはパスワードで接続するので、ここで設定する。
 * テストの globalSetup と、型の生成 (src/types.ts) が使う。
 */
export async function prepareDatabase(base: string, database: string): Promise<void> {
  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();

  const master = new Client({ connectionString: connectionUri(base, database) });
  await master.connect();
  await master.query(bootstrapSql);
  for (const role of roles) await master.query(`ALTER ROLE ${role} PASSWORD '${rolePassword}'`);
  await master.end();

  await migrate(migratorUrl(base, database, rolePassword));
}

/**
 * `prepareDatabase` に続けて seed を流す。結合テストのテンプレートの DB を作る (docs/adr/0036)。各テストはこれを複製し、
 * seed にない自分のテナントでデータを作る。型の生成 (src/types.ts) は seed を流さないので、`prepareDatabase` を使う。
 */
export async function prepareSeededDatabase(base: string, database: string): Promise<void> {
  await prepareDatabase(base, database);
  await seed(migratorUrl(base, database, rolePassword));
}
