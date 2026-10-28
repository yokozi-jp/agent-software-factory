-- Better Auth の rate limit の表 (#236、docs/adr/0022、docs/adr/0025)。
-- API は複数のインスタンスで動くので、回数を DB に置き、インスタンスをまたいで数える
-- (authOptions の rateLimit.storage = "database")。
--
-- 表の定義は Better Auth 1.7 の CLI (`auth generate`) と同じ内容。権限は auth スキーマの
-- ALTER DEFAULT PRIVILEGES (20261027000000_create_auth_schema.sql) で auth_service に付く。
-- "lastRequest" は、最後の要求の時刻 (Unix epoch のミリ秒)。
--
-- auth スキーマのほかの表と同じく、docs/db/ の規約 (snake_case とプレフィックスの物理名、キーワードを
-- 避けること、共通カラム、日時の timestamptz) に従わず、Better Auth の定義のままにしている。
-- 理由は docs/adr/0025 の「Better Auth の表」(docs/db の規約の例外)。

-- migrate:up
SET LOCAL lock_timeout = '5s';

CREATE TABLE auth."rateLimit" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
