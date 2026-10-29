-- モジュールのロールに権限を与える (Issue #268、docs/adr/0029)。ロールは bootstrap.sql が作る。
-- migrator のロールが実行する。スキーマと表の所有者なので、GRANT を出せる。
--
-- - 自分のスキーマ: USAGE と、表の SELECT、INSERT、UPDATE、DELETE。
-- - 依存の方向 (締め → 承認 → 申請) にだけ、ほかのモジュールのスキーマの USAGE と表の SELECT。
--   書き込みと、方向に逆らう読み取りは permission denied になる。
-- - 締めのバッチがテナントの一覧を読むために、auth.organization の id の列だけの SELECT
--   (docs/adr/0022 の例外。決定は Issue #354 の決定 12)。
-- - app_user には、モジュールのスキーマの権限を与えない。SET LOCAL ROLE で切り替えたときだけ使える。
-- - messaging.outbox の INSERT は、表を作る Issue #269 で足す。

-- migrate:up
SET LOCAL lock_timeout = '5s';

-- 自分のスキーマ。ALTER DEFAULT PRIVILEGES は、これから migrator が作る表にも同じ権限を付ける。
GRANT USAGE ON SCHEMA claim TO claim_module;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA claim TO claim_module;
ALTER DEFAULT PRIVILEGES IN SCHEMA claim GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO claim_module;

GRANT USAGE ON SCHEMA approval TO approval_module;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA approval TO approval_module;
ALTER DEFAULT PRIVILEGES IN SCHEMA approval GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO approval_module;

GRANT USAGE ON SCHEMA closing TO closing_module;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA closing TO closing_module;
ALTER DEFAULT PRIVILEGES IN SCHEMA closing GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO closing_module;

-- 依存の方向。approval は claim を、closing は approval と claim を読める。
GRANT USAGE ON SCHEMA claim TO approval_module, closing_module;
GRANT SELECT ON ALL TABLES IN SCHEMA claim TO approval_module, closing_module;
ALTER DEFAULT PRIVILEGES IN SCHEMA claim GRANT SELECT ON TABLES TO approval_module, closing_module;

GRANT USAGE ON SCHEMA approval TO closing_module;
GRANT SELECT ON ALL TABLES IN SCHEMA approval TO closing_module;
ALTER DEFAULT PRIVILEGES IN SCHEMA approval GRANT SELECT ON TABLES TO closing_module;

-- テナントの一覧。id の列だけで、ほかの列とほかの auth の表には権限を与えない。
GRANT USAGE ON SCHEMA auth TO closing_module;
GRANT SELECT ("id") ON auth."organization" TO closing_module;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
