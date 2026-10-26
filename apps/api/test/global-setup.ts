import { readFileSync } from "node:fs";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import { Client } from "pg";
import type { TestProject } from "vite-plus/test/node";

import { rolePassword } from "./credentials.ts";

// 結合テストは、本物の PostgreSQL と Keycloak を相手にする (docs/db/postgresql-test.md、docs/adr/0022)。
// 一度だけ起動して全テストで使う。テストごとに別のデータベースを作るので、並列に走らせられる (ロールはクラスタ全体で共有する)。
declare module "vite-plus/test" {
  export interface ProvidedContext {
    postgresUri: string;
    keycloakBaseUrl: string;
  }
}

const realmFile = new URL("./keycloak/factory-realm.json", import.meta.url);

export default async function setup(project: TestProject) {
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

  // ロールはクラスタ全体で共有する。インフラが作るものを、ここで代わりに作る (db/auth-schema.sql の冒頭)。
  const admin = new Client({ connectionString: postgres.getConnectionUri() });
  await admin.connect();
  await admin.query(`CREATE ROLE auth_service LOGIN PASSWORD '${rolePassword}'`);
  await admin.query(`CREATE ROLE app_user LOGIN PASSWORD '${rolePassword}'`);
  await admin.end();

  project.provide("postgresUri", postgres.getConnectionUri());
  project.provide(
    "keycloakBaseUrl",
    `http://${keycloak.getHost()}:${keycloak.getMappedPort(8080)}`,
  );

  return async () => {
    await Promise.all([postgres.stop(), keycloak.stop()]);
  };
}
