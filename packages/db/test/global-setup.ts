import { Client } from "pg";
import type { TestProject } from "vite-plus/test/node";

import {
  prepareSeededDatabase,
  reportSetupFailure,
  startPostgres,
  templateDatabase,
} from "../src/testing/index.ts";
import { diffRoles, snapshotRoles } from "../src/testing/role-snapshot.ts";

// One PostgreSQL for all the tests, with the migrations and then the seed run once on the template database (docs/adr/0025, 0036).
export default function setup(project: TestProject) {
  return reportSetupFailure("test/global-setup.ts", () => start(project));
}

async function start(project: TestProject) {
  const postgres = await startPostgres();
  const base = postgres.getConnectionUri();
  await prepareSeededDatabase(base, templateDatabase);

  project.provide("postgresUri", base);
  project.provide("templateDatabase", templateDatabase);

  const rolesBefore = await rolesOf(base);

  return () =>
    reportSetupFailure("test/global-setup.ts (teardown)", async () => {
      try {
        // ロールの属性とメンバーシップはクラスタ全体のもので、テストがコミットすると、並行して流れる別のテストファイルが
        // 壊れた状態を読む (Issue #448)。テストの前後で変わっていたら、変えたテストを直す (testing/rolled-back.ts)。
        const changes = diffRoles(rolesBefore, await rolesOf(base));
        if (changes.length > 0) {
          throw new Error(
            `テストがロールをコミットして変えた。壊す変更は rolledBackPerTest の中で流す:\n${changes.join("\n")}`,
          );
        }
      } finally {
        await postgres.stop();
      }
    });
}

async function rolesOf(base: string): Promise<string[]> {
  const client = new Client({ connectionString: base });
  await client.connect();
  try {
    return await snapshotRoles(client);
  } finally {
    await client.end();
  }
}
