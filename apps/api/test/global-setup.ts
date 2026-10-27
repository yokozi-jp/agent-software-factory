import { readFileSync } from "node:fs";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import type { TestProject } from "vite-plus/test/node";

import { templateDatabase } from "./connection.ts";
import { prepareDatabase } from "./prepare-database.ts";

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

  // 本番と同じ経路で、テンプレートの DB に 1 回だけ migration を流す (docs/adr/0025)。
  const base = postgres.getConnectionUri();
  await prepareDatabase(base, templateDatabase);

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
