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

-- 申請 (GLOSSARY.md)。業務のカラムは、サンプル機能の仕様で足す。今は、キーと共通カラムだけを持つ。
-- - キー: トランの表なのでサロゲートキーにし、単一の DB なので連番 (IDENTITY の ALWAYS) にする
--   (docs/db/postgresql-keys.md、docs/db/postgresql-column-identity-default.md)。一意キーにテナントを含める (docs/adr/0011)。
-- - 共通カラム: docs/db/postgresql-keys.md の「共通カラム」。日時はアプリがバインドするので既定値を持たない。
--   *_by、*_pgm_cd、*_tx_id の桁は、利用者の id (uuid の 36 文字)、プログラムのコード、トランザクションの id が
--   入る長さとして 64 にした。patched_* はデータパッチのときだけ入れる。
-- テナントを持つ表なので、RLS を有効にして所有者にも強制する (docs/adr/0011)。
CREATE TABLE claim.t_claim (
  tenant_id uuid NOT NULL,
  claim_id bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL,
  created_by varchar(64) NOT NULL,
  created_pgm_cd varchar(64) NOT NULL,
  created_tx_id varchar(64) NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by varchar(64) NOT NULL,
  updated_pgm_cd varchar(64) NOT NULL,
  updated_tx_id varchar(64) NOT NULL,
  lock_no integer NOT NULL DEFAULT 1,
  patched_at timestamptz,
  patched_by varchar(64),
  patched_id varchar(64),
  CONSTRAINT pk_t_claim PRIMARY KEY (tenant_id, claim_id)
);

ALTER TABLE claim.t_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim.t_claim FORCE ROW LEVEL SECURITY;

-- missing_ok を使わず、テナントを設定し忘れたらエラーにする (docs/adr/0011)。
CREATE POLICY tenant_isolation ON claim.t_claim
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
