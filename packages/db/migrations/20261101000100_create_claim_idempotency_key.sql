-- 申請 (claim) の冪等キーの表 (Issue #522、#554、docs/adr/0040)。最初の POST の route (POST /api/claims) が使う。
-- packages/db/templates/idempotency_key.sql の `{{module}}` を claim に替えた写し。表の定義を勝手に変えない
-- (shared-kernel の withIdempotencyKey が、この列に決めたとおりに書く)。雛形の説明は雛形の先頭にある。

-- migrate:up
SET LOCAL lock_timeout = '5s';

CREATE TABLE claim.idempotency_key (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  status_code smallint,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
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
  CONSTRAINT pk_idempotency_key PRIMARY KEY (tenant_id, user_id, idempotency_key)
);

-- 他のモジュールは、この表を読まない。
REVOKE ALL ON claim.idempotency_key FROM claim_module, approval_module, closing_module;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim.idempotency_key TO claim_module;

-- 期限切れの行を掃除する処理 (Issue #325) が、テナントごとに expires_at の古い順で探す。テナントを先頭にして、
-- 他のテナントの期限切れの行を走査して捨てないようにする。
CREATE INDEX idx_idempotency_key_tenant_expires_at ON claim.idempotency_key (tenant_id, expires_at);

ALTER TABLE claim.idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim.idempotency_key FORCE ROW LEVEL SECURITY;

-- missing_ok を使わず、テナントを設定し忘れたらエラーにする (docs/adr/0011)。
CREATE POLICY tenant_isolation ON claim.idempotency_key
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
