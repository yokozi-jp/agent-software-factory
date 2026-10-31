-- 承認モジュールの受信の重複除去の表 processed_message (Issue #366、docs/adr/0029、docs/adr/0041)。
-- packages/db/templates/processed_message.sql を写したもの。表の定義は雛形のままにする (shared-kernel の
-- recordProcessedMessage と defineConsumer が、この列に決めたとおりに書く)。
--
-- 通知メールの処理 (handleNotification) が、メッセージの行を確かめ、SES で送り、その後に短いトランザクションで
-- 行を入れる。message_id は、送り手のイベントの id (messaging.outbox の id)。
-- 権限は、モジュールのスキーマの ALTER DEFAULT PRIVILEGES (20261028000000_grant_module_roles.sql) で
-- approval_module に付く。テナントを持つ表なので、RLS を有効にして所有者にも強制する (docs/adr/0011)。

-- migrate:up
SET LOCAL lock_timeout = '5s';

CREATE TABLE approval.processed_message (
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

ALTER TABLE approval.processed_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval.processed_message FORCE ROW LEVEL SECURITY;

-- missing_ok を使わず、テナントを設定し忘れたらエラーにする (docs/adr/0011)。
CREATE POLICY tenant_isolation ON approval.processed_message
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
