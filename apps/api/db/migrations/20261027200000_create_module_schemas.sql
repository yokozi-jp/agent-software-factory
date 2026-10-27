-- サンプル機能のモジュールのスキーマ (docs/adr/0025、docs/adr/0026、docs/adr/0029)。
-- スキーマの名前は GLOSSARY.md のモジュールの英語名: 申請 (claim)、承認 (approval)、締め (closing)。
-- migrator のロールが実行し、スキーマと表の所有者になる。
--
-- 型は、このスキーマごとに kysely-codegen で packages/<モジュール>/src/infrastructure/db.gen.ts に生成する
-- (apps/api の `pnpm exec nx db-types api`)。あるモジュールの Kysely<DB> から、ほかのモジュールの表は見えない。
--
-- 権限は app_user に与えない。モジュールごとの NOLOGIN のロール (<モジュール>_module) を作って、そこに与える
-- (Issue #268、docs/adr/0029)。それまでは、アプリのロールはどのモジュールの表も読めない。

-- migrate:up
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA claim;
CREATE SCHEMA approval;
CREATE SCHEMA closing;

-- 申請 (GLOSSARY.md)。業務のカラムは、サンプル機能の仕様で足す。今は、型の生成と、モジュールの型の境界を
-- 確かめるための最小の形 (テナントと id) だけを持つ。
-- テナントを持つ表なので、RLS を有効にして所有者にも強制する (docs/adr/0011)。
CREATE TABLE claim.t_claim (
  tenant_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  CONSTRAINT pk_t_claim PRIMARY KEY (tenant_id, claim_id)
);

ALTER TABLE claim.t_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim.t_claim FORCE ROW LEVEL SECURITY;

-- missing_ok を使わず、テナントを設定し忘れたらエラーにする (docs/adr/0011)。
CREATE POLICY tenant_isolation ON claim.t_claim
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
