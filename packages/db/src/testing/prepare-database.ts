import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
 * 更新の試験 (docs/adr/0037) が、PR の migration のファイルを渡す環境変数。値は絶対 path の JSON の配列。
 * `tools/scripts/src/checks/migration-compat/` が、base の版のこのファイルにこの名前があるかで、base が更新の試験に
 * 対応しているかを判断する。名前を変えるときは、そちらの `harnessMarker` も変える。
 */
const extraMigrationsVariable = "MIGRATION_COMPAT_FILES";

/** 環境変数から、seed の後に流す migration のファイルを読む。ないときは空。 */
function extraMigrationFiles(env: Record<string, string | undefined>): string[] {
  const value = env[extraMigrationsVariable];
  if (value === undefined || value === "") return [];
  const files: unknown = JSON.parse(value);
  if (!Array.isArray(files) || !files.every((file) => typeof file === "string")) {
    throw new Error(
      `${extraMigrationsVariable} は文字列の JSON の配列でなければならない: ${value}`,
    );
  }
  return files;
}

/**
 * `prepareDatabase` に続けて seed を流す。結合テストのテンプレートの DB を作る (docs/adr/0036)。各テストはこれを複製し、
 * seed にない自分のテナントでデータを作る。型の生成 (src/types.ts) は seed を流さないので、`prepareDatabase` を使う。
 * 環境変数 `extraMigrationsVariable` があれば、seed の後にそのファイルの migration を流す。base の migration、seed、PR の
 * migration の順にして、前の版のアプリが新しいスキーマで動くかを試す (更新の試験、docs/adr/0037)。ないときは何も足さない。
 */
export async function prepareSeededDatabase(
  base: string,
  database: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const extra = extraMigrationFiles(env);
  await prepareDatabase(base, database);
  const url = migratorUrl(base, database, rolePassword);
  await seed(url);
  if (extra.length > 0) await migrateFiles(url, extra);
}

// 指定されたファイルだけを置いたディレクトリで migrate を流す。適用済みの migration は履歴にあるので、再び流れない。
async function migrateFiles(databaseUrl: string, files: readonly string[]): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "extra-migrations-"));
  try {
    for (const file of files) await copyFile(file, join(dir, basename(file)));
    await migrate(databaseUrl, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
