import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  generateTypes,
  moduleSchemasOf,
  staleTypes,
  typedSchemas,
  typesFile,
  withColumnTypeImport,
  writeTypes,
  type GeneratedTypes,
} from "./types.ts";
import { createTestDatabase, type TestDatabase } from "./testing/database.ts";

// モジュールのスキーマごとの型の生成と、migration とのずれの検査 (src/types.ts、docs/adr/0025)。
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

describe("モジュールの型の生成 (src/types.ts)", () => {
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
      "packages/approval/src/infrastructure/db.gen.ts",
      "packages/claim/src/infrastructure/db.gen.ts",
      "packages/closing/src/infrastructure/db.gen.ts",
      "packages/shared-kernel/src/messaging.gen.ts",
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
    expect(tableNames(typesOf(types, "messaging"))).toEqual(["messaging.outbox"]);
  });

  it("auth と migrations のスキーマの表を、どの型のファイルにも入れないこと", async () => {
    const types = await generateTypes(db.url());

    const names = types.flatMap(tableNames);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => /^(auth|migrations|public)\./.test(name))).toEqual([]);
    expect(names.every((name) => typedSchemas.some((s) => name.startsWith(`${s}.`)))).toBe(true);
  });

  it("migration が作るスキーマが、auth と migrations のほかは、型を生成するスキーマと同じこと", async () => {
    // migration でモジュールのスキーマを足して package.json の tag `type:module` を付け忘れると、そのスキーマの型を生成せず、
    // CI のずれの検査も通ってしまう。public は PostgreSQL が作る。
    const { rows } = await db.superuser.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema', 'public')
       ORDER BY nspname`,
    );

    expect(rows.map(({ nspname }) => nspname)).toEqual(
      [...typedSchemas, "auth", "migrations"].toSorted(),
    );
  });

  it("timestamptz と date の列を、読みが Temporal、書きが string の ColumnType にすること", async () => {
    await db.migrator.query(`CREATE TABLE approval.t_example (at timestamptz NOT NULL, day date)`);

    const { content } = typesOf(await generateTypes(db.url()), "approval");

    expect(content).toContain(`import type { ColumnType } from "kysely";`);
    expect(content).toContain("at: ColumnType<Temporal.Instant, string, string>;");
    expect(content).toContain("day: ColumnType<Temporal.PlainDate, string, string> | null;");
    expect(content).not.toMatch(/\bDate\b/);
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

describe("withColumnTypeImport", () => {
  const body = "export interface DB {\n  at: ColumnType<Temporal.Instant, string, string>;\n}\n";

  it("ColumnType を使うのに import がなければ、先頭の export の前に足すこと", () => {
    const header = "/**\n * generated\n */\n\n";

    expect(withColumnTypeImport(header + body)).toBe(
      `${header}import type { ColumnType } from "kysely";\n\n${body}`,
    );
  });

  it("import があるときと、ColumnType を使わないときは、そのまま返すこと", () => {
    const imported = `import type { ColumnType } from "kysely";\n\n${body}`;
    const unused = "export interface DB {}\n";

    expect(withColumnTypeImport(imported)).toBe(imported);
    expect(withColumnTypeImport(unused)).toBe(unused);
  });
});

describe("モジュールのスキーマ (moduleSchemas)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "db-schemas-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const addPackage = async (directory: string, manifest: unknown): Promise<void> => {
    await mkdir(join(root, "packages", directory), { recursive: true });
    await writeFile(join(root, "packages", directory, "package.json"), JSON.stringify(manifest));
  };

  it("tag type:module を持つ package の名前を、名前順で返すこと", async () => {
    await addPackage("b", { nx: { name: "b", tags: ["type:module"] } });
    await addPackage("a", { nx: { name: "a", tags: ["scope:x", "type:module"] } });

    expect(moduleSchemasOf(root)).toEqual(["a", "b"]);
  });

  it("tag のない package、別の tag だけの package、nx のない package、名前のない package、package.json のないディレクトリを含めないこと", async () => {
    await addPackage("none", { nx: { name: "none" } });
    await addPackage("other", { nx: { name: "other", tags: ["type:util"] } });
    await addPackage("no-nx", {});
    await mkdir(join(root, "packages", "empty-directory"), { recursive: true });
    await addPackage("no-array", { nx: { name: "no-array", tags: "type:module" } });
    await addPackage("unnamed", { nx: { tags: ["type:module"] } });

    expect(moduleSchemasOf(root)).toEqual([]);
  });
});
