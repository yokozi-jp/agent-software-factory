import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { migrate } from "../../db/migrate.ts";
import { bootstrapSql } from "../../test/bootstrap.ts";
import { postgresImage, migratorUrl, roles } from "../../test/connection.ts";

// migration を流す入口 (db/migrate.ts) と、ロールを作る bootstrap.sql (docs/adr/0025)。
// 共有の PostgreSQL ではなく専用のコンテナを使う。rds_iam のロールはクラスタ全体のもので、作ると
// ほかのテストのロールに影響するため。
// it は上から順に、1 つのクラスタの状態を進める (bootstrap → rds_iam を作る → migrate)。順番を変えない。
describe("bootstrap.sql と migrate", () => {
  let postgres: StartedPostgreSqlContainer;
  let master: Client;

  const memberships = async (role: string): Promise<string[]> =>
    (
      await master.query<{ rolname: string }>(
        `SELECT r.rolname FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.roleid
         WHERE m.member = $1::regrole ORDER BY r.rolname`,
        [role],
      )
    ).rows.map((row) => row.rolname);

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(postgresImage).start();
    master = new Client({ connectionString: postgres.getConnectionUri() });
    await master.connect();
  });

  afterAll(async () => {
    await master.end();
    await postgres.stop();
  });

  it("2 回流しても失敗しないこと", async () => {
    await master.query(bootstrapSql);
    await master.query(bootstrapSql);

    const roles = await master.query(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('migrator', 'app_user', 'auth_service')`,
    );
    expect(roles.rowCount).toBe(3);
  });

  it("rds_iam のロールがなければ、何も付かないこと", async () => {
    for (const role of roles) expect(await memberships(role)).toEqual([]);
  });

  it("rds_iam のロールがあれば、3 つのロールに付くこと", async () => {
    await master.query(`CREATE ROLE rds_iam`);
    await master.query(bootstrapSql);

    for (const role of roles) expect(await memberships(role)).toEqual(["rds_iam"]);
  });

  it("migrate が全部を適用し、2 回目は何も適用せず成功すること", async () => {
    await master.query(`ALTER ROLE migrator PASSWORD 'pw'`);
    const url = migratorUrl(postgres.getConnectionUri(), postgres.getDatabase(), "pw");

    expect(await migrate(url)).toContain("Applying: ");
    const again = await migrate(url);

    expect(again).not.toContain("Applying: ");
    const applied = await master.query(`SELECT version FROM migrations.schema_migrations`);
    expect(applied.rowCount).toBeGreaterThan(0);
    const owner = await master.query(
      `SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'migrations'`,
    );
    expect(owner.rows).toEqual([{ owner: "migrator" }]);
  });

  it("migrate が失敗したときは dbmate の stderr を載せて投げること", async () => {
    const unreachable = migratorUrl(postgres.getConnectionUri(), "no_such_database", "secret-pw");

    const error = await migrate(unreachable).catch((e: unknown) => e);

    expect(String(error)).toMatch(/dbmate migrate が失敗した/);
    expect(String(error)).not.toContain("secret-pw");
  });
});
