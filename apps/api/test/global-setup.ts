import {
  postgresImage,
  prepareSeededDatabase,
  reportSetupFailure,
  templateDatabase,
} from "@agent-software-factory/db/testing";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { startTestIdp } from "./oidc-provider.ts";
import type { TestProject } from "vite-plus/test/node";

// 結合テストは、本物の PostgreSQL と、プロセスの中のテスト用 IdP (oidc-provider.ts) を相手にする (docs/db/postgresql-test.md、docs/adr/0022)。
// 一度だけ起動して全テストで使う。テストごとに別のデータベースを作るので、並列に走らせられる (ロールはクラスタ全体で共有する)。
declare module "vite-plus/test" {
  export interface ProvidedContext {
    // postgresUri と templateDatabase は packages/db の testing が宣言する (docs/adr/0038)。
    oidcIssuer: string;
  }
}

export default function setup(project: TestProject) {
  return reportSetupFailure("test/global-setup.ts", () => start(project));
}

async function start(project: TestProject) {
  const [postgres, idp] = await Promise.all([
    new PostgreSqlContainer(postgresImage).start(),
    startTestIdp(),
  ]);

  // 本番と同じ経路で、テンプレートの DB に 1 回だけ migration を流し、続けて seed を流す (docs/adr/0025、0036)。
  const base = postgres.getConnectionUri();
  await prepareSeededDatabase(base, templateDatabase);

  project.provide("postgresUri", base);
  project.provide("templateDatabase", templateDatabase);
  project.provide("oidcIssuer", idp.issuer);

  return async () => {
    await Promise.all([postgres.stop(), idp.stop()]);
  };
}
