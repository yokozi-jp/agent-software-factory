import { Client } from "pg";
import { describe, expect, inject, it, vi } from "vite-plus/test";

import {
  connectionUri,
  createTestDatabase,
  prepareDatabase,
  reportSetupFailure,
  roles,
} from "./index.ts";

// db/testing は、packages/db 自身のテストと apps/api のテストが使う道具 (docs/adr/0038)。
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
