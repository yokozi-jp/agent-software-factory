-- 申請 (claim.t_claim) に、下書きを作る最初の route (POST /api/claims) が書く業務のカラムを足す (Issue #554)。
-- expand の段: 前の版のアプリは、この 2 つを書かずに INSERT する (docs/adr/0037 の更新の試験)。そのため、
-- applicant_id は NULL を許し、status_typ は既定値 '00' (下書き) を持つ。アプリがどちらも書く形に切り替えたあと、
-- contract の段の migration で applicant_id を NOT NULL にし、status_typ の既定値を外す。
--
-- - applicant_id: 申請者。申請を作った社員 (セッションの利用者の id) で、created_by (監査のカラム) とは別に持つ。
--   `{カラム}_id` の命名 (docs/db/postgresql-naming-physical.md)。外部キーは張らない (docs/db/postgresql-constraints.md)。
-- - status_typ: 申請の状態の区分 (`{カラム}_typ`)。連番のコード値で持つ (docs/db/postgresql-naming-value-domain.md)。
--   区分値の定義は packages/claim/src/infrastructure/claim-store.ts の statusCodes が正で、DB に CHECK 制約は置かない
--   (docs/db/postgresql-constraints.md)。今あるのは 00: 下書き だけ。承認待ち以降は、その状態を書く route と一緒に足す。

-- migrate:up
SET LOCAL lock_timeout = '5s';

ALTER TABLE claim.t_claim
  ADD COLUMN applicant_id uuid,
  ADD COLUMN status_typ varchar(2) NOT NULL DEFAULT '00';

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
