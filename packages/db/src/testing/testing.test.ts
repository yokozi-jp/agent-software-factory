import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, inject, it, vi } from "vite-plus/test";

import {
  connectionUri,
  createTestDatabase,
  prepareDatabase,
  prepareSeededDatabase,
  reportSetupFailure,
  roles,
  startPostgres,
} from "./index.ts";

// db/testing は、packages/db 自身のテストと apps/api のテストが使う道具 (docs/adr/0038)。
describe("startPostgres", () => {
  it("永続化の設定を切った PostgreSQL を起動すること (globalSetup が起動したものと、起動し直したものの両方)", async () => {
    const restarted = await startPostgres();
    try {
      for (const uri of [inject("postgresUri"), restarted.getConnectionUri()]) {
        const client = new Client({ connectionString: uri });
        await client.connect();
        try {
          const { rows } = await client.query<{ name: string; setting: string }>(
            `SELECT name, setting FROM pg_settings
             WHERE name IN ('fsync', 'synchronous_commit', 'full_page_writes') ORDER BY name`,
          );
          expect(rows).toEqual([
            { name: "fsync", setting: "off" },
            { name: "full_page_writes", setting: "off" },
            { name: "synchronous_commit", setting: "off" },
          ]);
        } finally {
          await client.end();
        }
      }
    } finally {
      await restarted.stop();
    }
  });
});

describe("prepareDatabase", () => {
  it("データベースを作り、3 つのロールと migration のスキーマを用意すること", async () => {
    const base = inject("postgresUri");

    await prepareDatabase(base, "prepared_example");

    const client = new Client({ connectionString: connectionUri(base, "prepared_example") });
    await client.connect();
    try {
      const { rows } = await client.query<{ nspname: string }>(
        `SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'claim', 'migrations') ORDER BY nspname`,
      );
      expect(rows.map(({ nspname }) => nspname)).toEqual(["auth", "claim", "migrations"]);
    } finally {
      await client.end();
    }
  });
});

describe("prepareSeededDatabase", () => {
  it("migration に続けて seed を流し、型の生成が使う prepareDatabase は流さないこと", async () => {
    const base = inject("postgresUri");
    const countClaims = async (database: string): Promise<number> => {
      const client = new Client({ connectionString: connectionUri(base, database) });
      await client.connect();
      try {
        const { rows } = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM claim.t_claim",
        );
        return rows[0]?.count ?? -1;
      } finally {
        await client.end();
      }
    };

    await prepareSeededDatabase(base, "prepared_seeded");
    await prepareDatabase(base, "prepared_empty");

    expect(await countClaims("prepared_seeded")).toBeGreaterThan(0);
    expect(await countClaims("prepared_empty")).toBe(0);
  });
});

describe("prepareSeededDatabase の更新の試験の段 (docs/adr/0037)", () => {
  const schemas = async (database: string): Promise<string[]> => {
    const client = new Client({ connectionString: connectionUri(inject("postgresUri"), database) });
    await client.connect();
    try {
      const { rows } = await client.query<{ nspname: string }>(
        "SELECT nspname FROM pg_namespace WHERE nspname = 'compat_probe'",
      );
      return rows.map(({ nspname }) => nspname);
    } finally {
      await client.end();
    }
  };

  it("MIGRATION_COMPAT_FILES のファイルの migration を、seed の後に流すこと", async () => {
    const dir = await mkdtemp(join(tmpdir(), "compat-test-"));
    try {
      const file = join(dir, "29991231000000_create_compat_probe.sql");
      await writeFile(file, "-- migrate:up\nCREATE SCHEMA compat_probe;\n-- migrate:down\n");

      await prepareSeededDatabase(inject("postgresUri"), "prepared_extra", {
        MIGRATION_COMPAT_FILES: JSON.stringify([file]),
      });

      expect(await schemas("prepared_extra")).toEqual(["compat_probe"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("環境変数がない、または空なら、何も足さないこと", async () => {
    await prepareSeededDatabase(inject("postgresUri"), "prepared_no_extra", {});
    await prepareSeededDatabase(inject("postgresUri"), "prepared_empty_extra", {
      MIGRATION_COMPAT_FILES: "",
    });

    expect(await schemas("prepared_no_extra")).toEqual([]);
    expect(await schemas("prepared_empty_extra")).toEqual([]);
  });

  it("値が文字列の配列でなければ、データベースを作る前に投げること", async () => {
    await expect(
      prepareSeededDatabase(inject("postgresUri"), "prepared_bad_extra", {
        MIGRATION_COMPAT_FILES: '{"a":1}',
      }),
    ).rejects.toThrow(/MIGRATION_COMPAT_FILES/);
  });
});

describe("createTestDatabase", () => {
  it("url にロールを渡すとそのロールの接続先を、渡さないと superuser の接続先を返すこと", async () => {
    const db = await createTestDatabase();
    try {
      for (const role of roles) expect(new URL(db.url(role)).username).toBe(role);
      expect(new URL(db.url()).username).not.toBe("app_user");

      const { rows } = await db.appUser.query<{ role: string }>("SELECT current_user AS role");
      expect(rows).toEqual([{ role: "app_user" }]);
    } finally {
      await db.close();
    }
  });
});

describe("reportSetupFailure", () => {
  it("成功した値をそのまま返すこと", async () => {
    expect(await reportSetupFailure("x.ts", () => Promise.resolve(42))).toBe(42);
  });

  it("失敗を stderr に書いてから、同じ失敗を投げ直すこと", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const failure = new Error("container timeout");

    await expect(reportSetupFailure("x.ts", () => Promise.reject(failure))).rejects.toBe(failure);

    expect(write).toHaveBeenCalledWith(expect.stringContaining("x.ts"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("container timeout"));
    write.mockRestore();
  });
});
