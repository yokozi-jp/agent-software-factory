-- ローカルの PostgreSQL で、ロールにパスワードを設定する (compose.local.yaml、docs/tooling/local-worker.md)。
-- ロールは直前の 01-bootstrap.sql (packages/db/bootstrap.sql) が作る。本番は IAM 認証で、ここは通らない。
-- 使い捨てのローカルの DB のパスワードで、本物の秘密ではない。
ALTER ROLE migrator PASSWORD 'local-password'; -- betterleaks:allow
ALTER ROLE app_user PASSWORD 'local-password'; -- betterleaks:allow
ALTER ROLE auth_service PASSWORD 'local-password'; -- betterleaks:allow
ALTER ROLE outbox_relay PASSWORD 'local-password'; -- betterleaks:allow
