import {
  prepareDatabase,
  reportSetupFailure,
  startPostgres,
  templateDatabase,
} from "@agent-software-factory/db/testing";
import type { TestProject } from "vite-plus/test/node";

import { startElasticMq, startMailpit } from "./containers.ts";

// 結合テストは、本物の PostgreSQL、ElasticMQ、Mailpit を相手にする (docs/adr/0041、docs/async/testing.md)。一度だけ起動して全テストで
// 使う。テストごとに別のデータベース、別のキュー、別の宛先を使うので、並列に走らせられる。
declare module "vite-plus/test" {
  export interface ProvidedContext {
    // postgresUri と templateDatabase は packages/db の testing が宣言する (docs/adr/0038)。
    sqsEndpoint: string;
    smtpHost: string;
    smtpPort: number;
    mailpitApi: string;
  }
}

export default function setup(project: TestProject) {
  return reportSetupFailure("test/global-setup.ts", () => start(project));
}

async function start(project: TestProject) {
  const [postgres, elasticMq, mailpit] = await Promise.all([
    startPostgres(),
    startElasticMq(),
    startMailpit(),
  ]);

  const base = postgres.getConnectionUri();
  await prepareDatabase(base, templateDatabase);

  project.provide("postgresUri", base);
  project.provide("templateDatabase", templateDatabase);
  project.provide("sqsEndpoint", `http://${elasticMq.getHost()}:${elasticMq.getMappedPort(9324)}`);
  project.provide("smtpHost", mailpit.getHost());
  project.provide("smtpPort", mailpit.getMappedPort(1025));
  project.provide("mailpitApi", `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`);

  return async () => {
    await Promise.all([postgres.stop(), elasticMq.stop(), mailpit.stop()]);
  };
}
