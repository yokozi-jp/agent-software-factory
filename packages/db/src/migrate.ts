// migration を流す入口。dbmate の引数をここ 1 か所にまとめる (docs/adr/0025、docs/db/postgresql-migration.md)。
//   DATABASE_URL=postgres://migrator@host/db node src/migrate.ts
// DATABASE_URL は dbmate が読む。URL に password を書くときも、引数ではなく環境変数で渡すので ps に出ない。
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveBinary } from "dbmate";

const run = promisify(execFile);
const ownMigrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * 適用していない migration を全部流す。履歴の表は専用の `migrations` スキーマに置き、同時に流しても
 * lock で順番に待ち、schema.sql は書き出さない。DB は作らない (`up` ではなく `migrate`)。
 * `migrationsDir` は、流す migration のディレクトリ。既定はこの package の migrations/。履歴にあって `migrationsDir` にない
 * migration は無視される (更新の試験が、足された migration だけを後から流すのに使う。docs/adr/0037)。
 * 失敗したら dbmate の stderr を載せた Error を投げる。
 */
export async function migrate(
  databaseUrl: string,
  migrationsDir: string = ownMigrationsDir,
): Promise<string> {
  try {
    const { stdout } = await run(
      resolveBinary(),
      [
        "--migrations-dir",
        migrationsDir,
        "--migrations-table",
        "migrations.schema_migrations",
        "--migration-lock",
        "--no-dump-schema",
        "migrate",
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
    return stdout;
  } catch (error) {
    // execFile の Error の message に、コマンドと stderr が入る。環境変数 (DATABASE_URL) は入らない。
    throw new Error(`dbmate migrate が失敗した: ${String(error)}`, { cause: error });
  }
}

/* v8 ignore start -- the command line entry; the tests call migrate() */
if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    process.stderr.write("環境変数 DATABASE_URL が必要\n");
    process.exit(2);
  }
  process.stdout.write(await migrate(url));
}
/* v8 ignore stop */
