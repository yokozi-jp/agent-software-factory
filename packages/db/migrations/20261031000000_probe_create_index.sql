-- 試験用 (Issue #479)。merge しない。base のアプリを壊さない migration (索引を足すだけ) で、migration-compat が通ることと時間を測る。

-- migrate:up
SET LOCAL lock_timeout = '5s';

CREATE INDEX probe_479_claim_id ON claim.t_claim (claim_id);

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
