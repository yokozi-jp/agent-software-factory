// モジュールのスキーマごとの Kysely の型を、migration を流した DB から生成する (docs/adr/0025、docs/adr/0029)。
//   node src/types.ts          testcontainers の PostgreSQL に migration を流し、型のファイルを書く
//   node src/types.ts --check  同じく生成し、commit された型と違えば失敗する (CI の「DB types match the migrations」)
// Nx の target は `db-types` と `db-types-check` (packages/db/package.json)。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Cli } from "kysely-codegen";

import { postgresImage, connectionUri } from "./testing/connection.ts";
import { prepareDatabase } from "./testing/prepare-database.ts";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** モジュールの印。各モジュールの `package.json` の `nx.tags` に書く (docs/domain-model/add-module.md)。 */
export const moduleTag = "type:module";

/**
 * `root` の `packages/*` のうち、`nx.tags` に `type:module` を持つ package の Nx project の名前 (`nx.name`、
 * ディレクトリの名前と同じ)。名前順。モジュールの名前 (GLOSSARY.md) とスキーマの名前は同じ。
 */
export function moduleSchemasOf(root: string): string[] {
  return readdirSync(`${root}/packages`)
    .toSorted()
    .filter((directory) => existsSync(`${root}/packages/${directory}/package.json`))
    .flatMap((directory) => {
      const manifest: unknown = JSON.parse(
        readFileSync(`${root}/packages/${directory}/package.json`, "utf8"),
      );
      const nx = isRecord(manifest) ? manifest.nx : undefined;
      if (!isRecord(nx) || !Array.isArray(nx.tags) || !nx.tags.includes(moduleTag)) return [];
      return typeof nx.name === "string" ? [nx.name] : [];
    });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * モジュールのスキーマ。tag `type:module` を持つ package の名前から求める。
 * `auth` (Better Auth が自分の Kysely で使う) と `migrations` (dbmate の履歴) は対象にしない。
 */
export const moduleSchemas: readonly string[] = moduleSchemasOf(repositoryRoot);

/**
 * モジュールのスキーマのほかに、型を生成する共有のスキーマと、型を書くファイル。
 * `messaging` は Outbox の表で、型は `packages/shared` に置く (docs/adr/0029)。
 */
export const sharedSchemaFiles: Readonly<Record<string, string>> = {
  messaging: "packages/shared/src/messaging.gen.ts",
};

/** 型を生成するスキーマ: モジュールのスキーマと共有のスキーマ。 */
export const typedSchemas: readonly string[] = [
  ...moduleSchemas,
  ...Object.keys(sharedSchemaFiles),
];

/** スキーマの型を書くファイル。リポジトリのルートからの相対の path。 */
export const typesFile = (schema: string): string =>
  sharedSchemaFiles[schema] ?? `packages/${schema}/src/infrastructure/db.gen.ts`;

/**
 * 日時の列の型 (docs/adr/0043)。読みは `Temporal` で、書きは `toString()` の文字列に限る。
 * kysely-codegen の `typeMapping` は型の式をそのまま書くので、`ColumnType` で読みと書きを分けられる。
 */
export const typeMapping: Readonly<Record<string, string>> = {
  timestamptz: "ColumnType<Temporal.Instant, string, string>",
  date: "ColumnType<Temporal.PlainDate, string, string>",
};

const columnTypeImport = `import type { ColumnType } from "kysely";`;

/**
 * kysely-codegen は、`typeMapping` の型の式の中の `ColumnType` を数えないので、`Generated` や配列がない表だけのスキーマでは
 * `ColumnType` の import を書かない。生成した型が `ColumnType` を使うのに import がなければ、先頭の export の前に足す。
 */
export function withColumnTypeImport(content: string): string {
  if (!content.includes("ColumnType<") || content.includes(columnTypeImport)) return content;
  return content.replace(/^export /m, `${columnTypeImport}\n\nexport `);
}

export interface GeneratedTypes {
  /** リポジトリのルートからの相対の path。 */
  readonly file: string;
  readonly content: string;
}

/**
 * `databaseUrl` の DB を読み、`typedSchemas` のそれぞれについて、そのスキーマの表だけの型を返す。
 * 表の名前はスキーマ付き (`claim.t_claim`) にする。接続の search_path に頼らず、SQL にもスキーマが出る。
 * information_schema は権限のある列しか見せないので、表の所有者か superuser で接続する。
 */
export async function generateTypes(databaseUrl: string): Promise<GeneratedTypes[]> {
  const cli = new Cli();
  const generated: GeneratedTypes[] = [];
  for (const schema of typedSchemas) {
    const generatedContent = await cli.generate({
      url: databaseUrl,
      dialect: "postgres",
      includePattern: `${schema}.*`,
      // ファイルはここで書く。kysely-codegen には書かせない。
      outFile: null,
      logLevel: "error",
      typeMapping,
    });
    generated.push({ file: typesFile(schema), content: withColumnTypeImport(generatedContent) });
  }
  return generated;
}

/** 生成した型を `root` の下に書く。 */
export async function writeTypes(
  types: readonly GeneratedTypes[],
  root = repositoryRoot,
): Promise<void> {
  for (const { file, content } of types) {
    const path = `${root}/${file}`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}

/** `root` の下にある型のファイルのうち、生成した型と違うもの (ないものを含む) の path。 */
export async function staleTypes(
  types: readonly GeneratedTypes[],
  root = repositoryRoot,
): Promise<string[]> {
  const stale: string[] = [];
  for (const { file, content } of types) {
    const committed = await readFile(`${root}/${file}`, "utf8").catch(() => undefined);
    if (committed !== content) stale.push(file);
  }
  return stale;
}

/* v8 ignore start -- the command line entry; the tests call generateTypes() and the functions around it */
if (import.meta.main) {
  const check = process.argv.includes("--check");
  const postgres = await new PostgreSqlContainer(postgresImage).start();
  try {
    const database = "factory_types";
    await prepareDatabase(postgres.getConnectionUri(), database);
    const types = await generateTypes(connectionUri(postgres.getConnectionUri(), database));
    if (check) {
      const stale = await staleTypes(types);
      if (stale.length > 0) {
        process.stderr.write(
          `migration と型がずれている: ${stale.join(", ")}\n` +
            "`pnpm exec nx db-types db` で型を生成し直し、commit する (docs/db/postgresql-client.md)。\n",
        );
        process.exitCode = 1;
      }
    } else {
      await writeTypes(types);
    }
  } finally {
    await postgres.stop();
  }
}
/* v8 ignore stop */
