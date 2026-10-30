-- 受信の重複除去の表 processed_message の migration の雛形 (Issue #269、docs/adr/0029)。
-- イベントを受け取るモジュールが、自分のスキーマに 1 つ置く。{{module}} をモジュールの名前 (claim など) に替えて、
-- packages/db/migrations/<タイムスタンプ>_create_<モジュール>_processed_message.sql として写す。
-- 表の定義を勝手に変えない: shared の defineConsumer が、この列に決めたとおりに書く。
--
-- defineConsumer が、受け取った処理と同じトランザクションの中で (tenant_id, message_id) を INSERT … ON CONFLICT DO
-- NOTHING し、行が入ったときだけ業務の処理を呼ぶ。処理が失敗すると、この行も rollback される。
-- message_id は、送り手のイベントの id (messaging.outbox の id)。
--
-- 権限は、モジュールのスキーマの ALTER DEFAULT PRIVILEGES (20261028000000_grant_module_roles.sql) で、
-- {{module}}_module に付く。テナントを持つ表なので、RLS を有効にして所有者にも強制する (docs/adr/0011)。

-- migrate:up
SET LOCAL lock_timeout = '5s';

CREATE TABLE {{module}}.processed_message (
  tenant_id uuid NOT NULL,
  message_id uuid NOT NULL,
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
  CONSTRAINT pk_processed_message PRIMARY KEY (tenant_id, message_id)
);

ALTER TABLE {{module}}.processed_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE {{module}}.processed_message FORCE ROW LEVEL SECURITY;

-- missing_ok を使わず、テナントを設定し忘れたらエラーにする (docs/adr/0011)。
CREATE POLICY tenant_isolation ON {{module}}.processed_message
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
