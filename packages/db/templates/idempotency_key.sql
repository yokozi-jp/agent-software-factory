-- API の書き込みの冪等キーの表 idempotency_key の migration の雛形 (Issue #323、docs/adr/0040)。
-- 書き込みの API を持つモジュールが、自分のスキーマに 1 つ置く。{{module}} をモジュールの名前 (claim など) に替えて、
-- packages/db/migrations/<タイムスタンプ>_create_<モジュール>_idempotency_key.sql として写す。
-- 表の定義を勝手に変えない: shared-kernel の withIdempotencyKey が、この列に決めたとおりに書く。
--
-- withIdempotencyKey が、業務の更新と同じトランザクションの中で、(tenant_id, user_id, idempotency_key) の行を
-- INSERT … ON CONFLICT DO NOTHING し、行が入ったときだけ業務の処理を呼ぶ。2xx なら同じ行に status_code と
-- response_body を書いて commit する。2xx 以外と失敗は rollback するので、行も残らない。
-- 行が入らなかったとき (すでに行がある) は、request_hash を比べて、同じなら保存した応答を返す。
-- status_code と response_body は、INSERT から UPDATE までの同じトランザクションの中だけ NULL で、commit した行では
-- status_code が必ず入っている。response_body は、本文のない応答 (204 など) では NULL のまま。
-- request_hash は、method、経路、クエリ文字列、本文のバイト列の SHA-256 (16 進で 64 文字)。
-- expires_at は、作ってから 24 時間後。期限切れの行の掃除は Issue #325。
--
-- 権限は、モジュールのスキーマの ALTER DEFAULT PRIVILEGES (20261028000000_grant_module_roles.sql) で、
-- {{module}}_module に付く。同じ既定の権限が、依存の方向のモジュールにも SELECT を付けるが、この表には他人の
-- user_id と保存した応答が入るので、他のモジュールのロールの権限は外し、自分のロールだけに付け直す (ADR 0029 の最小の権限)。
-- テナントを持つ表なので、RLS を有効にして所有者にも強制する (docs/adr/0011)。

-- migrate:up
SET LOCAL lock_timeout = '5s';

CREATE TABLE {{module}}.idempotency_key (
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
REVOKE ALL ON {{module}}.idempotency_key FROM claim_module, approval_module, closing_module;
GRANT SELECT, INSERT, UPDATE, DELETE ON {{module}}.idempotency_key TO {{module}}_module;

-- 期限切れの行を掃除する処理 (Issue #325) が、テナントごとに expires_at の古い順で探す。テナントを先頭にして、
-- 他のテナントの期限切れの行を走査して捨てないようにする。
CREATE INDEX idx_idempotency_key_tenant_expires_at ON {{module}}.idempotency_key (tenant_id, expires_at);

ALTER TABLE {{module}}.idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE {{module}}.idempotency_key FORCE ROW LEVEL SECURITY;

-- missing_ok を使わず、テナントを設定し忘れたらエラーにする (docs/adr/0011)。
CREATE POLICY tenant_isolation ON {{module}}.idempotency_key
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
