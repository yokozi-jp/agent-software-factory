import { readFileSync } from "node:fs";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import { Client } from "pg";
import type { TestProject } from "vite-plus/test/node";

import { migrate } from "../db/migrate.ts";
import { rolePassword } from "./credentials.ts";
import { bootstrapSql } from "./bootstrap.ts";
import { connectionUri, migratorUrl, roles, templateDatabase } from "./connection.ts";

// 結合テストは、本物の PostgreSQL と Keycloak を相手にする (docs/db/postgresql-test.md、docs/adr/0022)。
// 一度だけ起動して全テストで使う。テストごとに別のデータベースを作るので、並列に走らせられる (ロールはクラスタ全体で共有する)。
declare module "vite-plus/test" {
  export interface ProvidedContext {
    postgresUri: string;
    /** migration を流し終えた DB。テストごとの DB は、これを TEMPLATE にして複製する。 */
    templateDatabase: string;
    keycloakBaseUrl: string;
  }
}

const realmFile = new URL("./keycloak/factory-realm.json", import.meta.url);

// vitest 5.0.5 (Vite+ 1.4.0) は globalSetup が投げた失敗を表示できない。失敗の stack を読むと、source map で
// 位置を直す処理が "TypeError: code.charCodeAt is not a function" を投げ、"No test files found" と一緒にそれだけが
// 出て、元の失敗が消える。そこで、stack を読まずに String(error) (名前と message) を stderr に書いてから投げ直す。
// コンテナの起動の待ちの時間切れ (別のセッションのテストでマシンが重いとき) などが、このメッセージで分かる。
export default async function setup(project: TestProject) {
  try {
    return await start(project);
  } catch (error) {
    process.stderr.write(`globalSetup (test/global-setup.ts) が失敗した: ${String(error)}\n`);
    throw error;
  }
}

async function start(project: TestProject) {
  const [postgres, keycloak] = await Promise.all([
    new PostgreSqlContainer("postgres:17").start(),
    new GenericContainer("quay.io/keycloak/keycloak:26.8.1")
      .withEnvironment({
        KC_BOOTSTRAP_ADMIN_USERNAME: "admin",
        KC_BOOTSTRAP_ADMIN_PASSWORD: "admin", // betterleaks:allow
      })
      .withCopyContentToContainer([
        {
          content: readFileSync(realmFile),
          target: "/opt/keycloak/data/import/factory-realm.json",
        },
      ])
      .withCommand(["start-dev", "--import-realm"])
      .withExposedPorts(8080)
      .withWaitStrategy(
        Wait.forHttp("/realms/factory/.well-known/openid-configuration", 8080).withStartupTimeout(
          180_000,
        ),
      )
      .start(),
  ]);

  // 本番と同じ経路で、テンプレートの DB に 1 回だけ migration を流す (docs/adr/0025)。
  // 1. master user (testcontainers の superuser) が bootstrap.sql でロールを作る。ロールはクラスタ全体で共有する。
  // 2. migrator が dbmate で migration を流す。ローカルはパスワードで接続するので、ここで設定する。
  const base = postgres.getConnectionUri();
  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${templateDatabase}`);
  await admin.end();

  const master = new Client({ connectionString: connectionUri(base, templateDatabase) });
  await master.connect();
  await master.query(bootstrapSql);
  for (const role of roles) await master.query(`ALTER ROLE ${role} PASSWORD '${rolePassword}'`);
  await master.end();

  await migrate(migratorUrl(base, templateDatabase, rolePassword));

  project.provide("postgresUri", base);
  project.provide("templateDatabase", templateDatabase);
  project.provide(
    "keycloakBaseUrl",
    `http://${keycloak.getHost()}:${keycloak.getMappedPort(8080)}`,
  );

  return async () => {
    await Promise.all([postgres.stop(), keycloak.stop()]);
  };
}
