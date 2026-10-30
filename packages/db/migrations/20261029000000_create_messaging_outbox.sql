-- Outbox の表 (Issue #269、docs/adr/0029)。モジュールをまたぐイベントを、業務の処理と同じトランザクションで書き、
-- 送る処理 (outbox_relay) が全テナントの行を読んで SQS へ送る。
-- migrator のロールが実行し、スキーマと表の所有者になる。ロールは db/bootstrap.sql が作る。
--
-- 列は Spring Modulith の event_publication (schema-postgresql.sql の v2) に寄せる。
-- - 同じ名前と意味: id、event_type、serialized_event、publication_date、completion_date、status、
--   completion_attempts、last_resubmission_date。
-- - 足す列: tenant_id、traceparent、event_version、occurred_at、共通カラム。
-- - 持たない列: listener_id。送る処理が SNS に送れば完了で、受け手ごとの完了は受け手の processed_message が持つ。
-- - serialized_event は jsonb (Spring Modulith は TEXT。docs/db/postgresql-column-json-lob.md)。
-- 形の検証は CHECK 制約にせず、書くとき (enqueueOutbox) と受けるとき (受け手の zod) に行う。
--
-- status: PUBLISHED (書いた)、PROCESSING (送っている)、COMPLETED (送った)、FAILED (送れなかった)、
-- RESUBMITTED (送り直す)。Spring Modulith の EventPublication.Status と同じ。
-- 完了した行: Spring Modulith の既定 (completion-mode = UPDATE) に合わせ、消さずに completion_date と
-- status を更新して残す。古い完了済みの行は、送る処理が DELETE で掃除する (Spring Modulith の
-- CompletedEventPublications.deletePublicationsOlderThan と同じ)。Outbox の表そのものをキューにはしない。
--
-- 権限と RLS:
-- - モジュールのロール (<module>_module): INSERT だけ。ポリシーは app.current_tenant で比べる。
-- - outbox_relay: SELECT、UPDATE、DELETE だけ。USING (true) のポリシーで全テナントの行を扱う。これが
--   ADR 0011 の「全テナントを一度に処理しない」への唯一の例外 (ADR 0029)。
-- - app_user: 何も持たない。outbox_relay のメンバーにもならない。

-- migrate:up
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA messaging;

CREATE TABLE messaging.outbox (
  tenant_id uuid NOT NULL,
  -- イベントの id。受け手の processed_message の message_id と同じ値になる。
  id uuid NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL,
  serialized_event jsonb NOT NULL,
  -- W3C Trace Context の traceparent。書いたときの span がなければ NULL。
  traceparent text,
  occurred_at timestamptz NOT NULL,
  publication_date timestamptz NOT NULL,
  completion_date timestamptz,
  status text NOT NULL DEFAULT 'PUBLISHED',
  completion_attempts integer NOT NULL DEFAULT 0,
  last_resubmission_date timestamptz,
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
  CONSTRAINT pk_outbox PRIMARY KEY (tenant_id, id)
);

-- 送る処理が、未完了の行を古い順に拾う。
CREATE INDEX outbox_incomplete_idx ON messaging.outbox (publication_date) WHERE completion_date IS NULL;
-- 送る処理が、完了して古くなった行を掃除する。
CREATE INDEX outbox_completion_date_idx ON messaging.outbox (completion_date) WHERE completion_date IS NOT NULL;

ALTER TABLE messaging.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging.outbox FORCE ROW LEVEL SECURITY;

-- missing_ok を使わず、テナントを設定し忘れたらエラーにする (docs/adr/0011)。
CREATE POLICY tenant_insert ON messaging.outbox
  FOR INSERT TO claim_module, approval_module, closing_module
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- RLS の例外は、この 1 つだけ (docs/adr/0029。カタログのテストが pg_policies で確かめる)。
CREATE POLICY relay_all_tenants ON messaging.outbox
  FOR ALL TO outbox_relay
  USING (true);

GRANT USAGE ON SCHEMA messaging TO claim_module, approval_module, closing_module, outbox_relay;
GRANT INSERT ON messaging.outbox TO claim_module, approval_module, closing_module;
GRANT SELECT, UPDATE, DELETE ON messaging.outbox TO outbox_relay;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
