-- 試験用 (Issue #479)。merge しない。base のアプリが使う列を消し、migration-compat が失敗することを確かめる。

-- migrate:up
SET LOCAL lock_timeout = '5s';

ALTER TABLE claim.t_claim DROP COLUMN lock_no;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
