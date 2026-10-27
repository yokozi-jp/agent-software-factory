-- Better Auth の表を置く auth スキーマ (docs/adr/0022、docs/adr/0025)。
-- migrator のロールが実行し、スキーマと表の所有者になる。
--
-- ロールは db/bootstrap.sql が作る。
-- - auth_service: Better Auth だけが使う。auth スキーマの USAGE と、表の SELECT、INSERT、UPDATE、DELETE だけを持つ。
--   DDL は実行できない。
-- - app_user: 業務の処理が使う。auth スキーマの権限を持たない。RLS を迂回するロール (BYPASSRLS、所有者) にしない。
--
-- auth の表は RLS の対象にしない。隔離は、app_user に権限がないことと Better Auth のコードに依存する。
--
-- 表の定義は Better Auth 1.7 の CLI (`auth generate`) と同じ内容 (authOptions と authPlugins の設定)。
-- Better Auth の版を上げて表が変わるときは、生成の差分を読んで migration を手で足す。

-- migrate:up
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA auth;

GRANT USAGE ON SCHEMA auth TO auth_service;
-- これから migrator が auth に作る表の権限。表ごとの GRANT を書き忘れても、同じ権限になる。
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_service;

CREATE TABLE auth."user" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE auth."session" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  "activeOrganizationId" text
);

CREATE TABLE auth."account" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE auth."verification" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE auth."organization" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "logo" text,
  "createdAt" timestamptz NOT NULL,
  "metadata" text
);

CREATE TABLE auth."member" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "organizationId" uuid NOT NULL REFERENCES auth."organization" ("id") ON DELETE CASCADE,
  "userId" uuid NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "createdAt" timestamptz NOT NULL
);

CREATE TABLE auth."invitation" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
  "organizationId" uuid NOT NULL REFERENCES auth."organization" ("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text,
  "status" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "inviterId" uuid NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE
);

CREATE INDEX "session_userId_idx" ON auth."session" ("userId");
CREATE INDEX "account_userId_idx" ON auth."account" ("userId");
CREATE INDEX "verification_identifier_idx" ON auth."verification" ("identifier");
CREATE INDEX "member_organizationId_idx" ON auth."member" ("organizationId");
CREATE INDEX "member_userId_idx" ON auth."member" ("userId");
CREATE INDEX "invitation_organizationId_idx" ON auth."invitation" ("organizationId");
CREATE INDEX "invitation_email_idx" ON auth."invitation" ("email");

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
