import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vite-plus/test/node";

import {
  postgresImage,
  prepareDatabase,
  reportSetupFailure,
  templateDatabase,
} from "../src/testing/index.ts";

// One PostgreSQL for all the tests, with the migrations run once on the template database (docs/adr/0025).
export default function setup(project: TestProject) {
  return reportSetupFailure("test/global-setup.ts", () => start(project));
}

async function start(project: TestProject) {
  const postgres = await new PostgreSqlContainer(postgresImage).start();
  const base = postgres.getConnectionUri();
  await prepareDatabase(base, templateDatabase);

  project.provide("postgresUri", base);
  project.provide("templateDatabase", templateDatabase);

  return async () => {
    await postgres.stop();
  };
}
