import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  generateTypes,
  moduleSchemas,
  staleTypes,
  typesFile,
  writeTypes,
  type GeneratedTypes,
} from "../../db/types.ts";
import { createTestDatabase, type TestDatabase } from "../../test/database.ts";

// モジュールのスキーマごとの型の生成と、migration とのずれの検査 (db/types.ts、docs/adr/0025)。
// 検査の関数が、migration を変えて生成し直さない型を見つけることを確かめる (#43 の検出力)。
// CI の「DB types match the migrations」は、同じ関数で commit された型を確かめる。

/** 生成した型の `DB` の表の名前。 */
const tableNames = ({ content }: GeneratedTypes): string[] => {
  const body = /export interface DB \{([^}]*)\}/.exec(content)?.[1] ?? "";
  return [...body.matchAll(/"([^"]+)":/g)].map((match) => match[1] ?? "");
};

const typesOf = (types: readonly GeneratedTypes[], schema: string): GeneratedTypes => {
  const found = types.find(({ file }) => file === typesFile(schema));
  if (found === undefined) throw new Error(`${schema} の型がない`);
  return found;
};

describe("モジュールの型の生成 (db/types.ts)", () => {
  let db: TestDatabase;
  let root: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), "db-types-"));
  });

  afterEach(async () => {
    await db.close();
    await rm(root, { recursive: true, force: true });
  });

  it("各モジュールの package に、1 つずつ型のファイルを生成すること", async () => {
    const types = await generateTypes(db.url());

    expect(types.map(({ file }) => file)).toEqual([
      "packages/claim/src/infrastructure/db.gen.ts",
      "packages/approval/src/infrastructure/db.gen.ts",
      "packages/closing/src/infrastructure/db.gen.ts",
    ]);
  });

  it("型のファイルが、自分のスキーマの表だけをスキーマ付きの名前で持つこと", async () => {
    await db.migrator.query(`CREATE TABLE approval.t_example (tenant_id uuid NOT NULL)`);
    await db.migrator.query(`CREATE TABLE closing.t_example (tenant_id uuid NOT NULL)`);
    await db.superuser.query(`CREATE TABLE public.t_example (tenant_id uuid NOT NULL)`);

    const types = await generateTypes(db.url());

    expect(tableNames(typesOf(types, "claim"))).toEqual(["claim.t_claim"]);
    expect(tableNames(typesOf(types, "approval"))).toEqual(["approval.t_example"]);
    expect(tableNames(typesOf(types, "closing"))).toEqual(["closing.t_example"]);
  });

  it("auth と migrations のスキーマの表を、どの型のファイルにも入れないこと", async () => {
    const types = await generateTypes(db.url());

    const names = types.flatMap(tableNames);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => /^(auth|migrations|public)\./.test(name))).toEqual([]);
    expect(names.every((name) => moduleSchemas.some((s) => name.startsWith(`${s}.`)))).toBe(true);
  });

  it("書いた型と同じ migration から生成し直すと、ずれがないこと", async () => {
    await writeTypes(await generateTypes(db.url()), root);

    expect(await staleTypes(await generateTypes(db.url()), root)).toEqual([]);
  });

  it("migration で表を変えて生成し直さないと、そのスキーマの型のファイルをずれとして返すこと", async () => {
    await writeTypes(await generateTypes(db.url()), root);

    await db.migrator.query(`ALTER TABLE claim.t_claim ADD COLUMN note text`);

    expect(await staleTypes(await generateTypes(db.url()), root)).toEqual([
      "packages/claim/src/infrastructure/db.gen.ts",
    ]);
  });

  it("型のファイルがなければ、ずれとして返すこと", async () => {
    const types = await generateTypes(db.url());
    await writeTypes(
      types.filter(({ file }) => file !== typesFile("approval")),
      root,
    );

    expect(await staleTypes(types, root)).toEqual([
      "packages/approval/src/infrastructure/db.gen.ts",
    ]);
  });
});
